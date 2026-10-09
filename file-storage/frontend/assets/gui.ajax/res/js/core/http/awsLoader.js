import PydioApi from "./PydioApi";

export default () => {

    return import(/* webpackChunkName: 'aws-sdk' */ 'aws-sdk').then(aws => {

        class ManagedMultipart extends aws.S3.ManagedUpload{

            _partsRetries = []
            _abortRequested = false

            progress(info, data) {
                const upload = this._managedUpload;
                if (this.operation === 'putObject') {
                    info.part = 1;
                    info.key = this.params.Key;
                } else {
                    const partLoaded = info.loaded;
                    const partTotal = info.total;
                    upload.totalUploadedBytes += info.loaded - this._lastUploadedBytes;
                    this._lastUploadedBytes = info.loaded;
                    info = {
                        loaded: upload.totalUploadedBytes,
                        total: upload.totalBytes,
                        part: this.params.PartNumber,
                        partLoaded, partTotal,
                        key: this.params.Key,
                        partRetry: data.retryCount
                    };
                    try{
                        if(data.request.response.error){
                            info.partError = data.request.response.error;
                        }
                    } catch (e) {}
                }
                upload.emit('httpUploadProgress', [info]);
            }

            pause() {
                this._pause = true;
            }

            resume(){
                this._pause = false;
            }

            uploadPart(chunk, partNumber) {
                if(this.failed || this._abortRequested){
                    return;
                }
                if(this._pause){
                    setTimeout(()=>{
                        if(!this.failed && !this._abortRequested){
                            this.uploadPart(chunk, partNumber);
                        }
                    }, 1000);
                    return;
                }
                // Make sure to reupdate JWT after long uploads
                return PydioApi.getRestClient().getOrUpdateJwt().then(jwt => {
                    if(this.failed || this._abortRequested){
                        return;
                    }
                    // Update accessKeyId
                    this.service.config.credentials.accessKeyId = jwt;

                    const self = this;
                    self._partsRetries[partNumber] = (self._partsRetries[partNumber]||0) + 1

                    const partParams = {
                        Body: chunk,
                        ContentLength: aws.util.string.byteLength(chunk),
                        PartNumber: partNumber
                    };

                    const partInfo = {ETag: null, PartNumber: partNumber};
                    self.completeInfo[partNumber] = partInfo;

                    const req = self.service.uploadPart(partParams);
                    self.parts[partNumber] = req;
                    req._lastUploadedBytes = 0;
                    req._managedUpload = self;
                    req.on('httpUploadProgress', self.progress);
                    req.send(function(err, data) {
                        if(self.failed || self._abortRequested){
                            return;
                        }
                        delete self.parts[partParams.PartNumber];
                        self.activeParts--;

                        if (!err && (!data || !data.ETag)) {
                            var message = 'No access to ETag property on response.';
                            if (aws.util.isBrowser()) {
                                message += ' Check CORS configuration to expose ETag header.';
                            }

                            err = aws.util.error(new Error(message), {
                                code: 'ETagMissing', retryable: false
                            });
                        }
                        if(err) {
                            // A received authentication refusal can renew its
                            // token. A timeout/retryable transport error is not
                            // evidence that the native part was never written.
                            if (err.statusCode === 401 && self._partsRetries[partNumber] <= 3) {
                                self.uploadPart(chunk, partNumber);
                                return err
                            } else {
                                return self.cleanup(err)
                            }
                        }

                        //prevent sending part being returned twice (https://github.com/aws/aws-sdk-js/issues/2304)
                        if (self.completeInfo[partNumber] && self.completeInfo[partNumber].ETag !== null) return null;
                        partInfo.ETag = data.ETag;
                        self.doneParts++;
                        if (self.isDoneChunking && self.doneParts === self.totalPartNumbers) {
                            self.finishMultiPart();
                        } else {
                            self.fillQueue.call(self);
                        }
                    });


                }).catch(err => this.cleanup(err));
            }

            finishMultiPart(){
                if(this.failed || this._abortRequested){
                    return;
                }
                return PydioApi.getRestClient().getOrUpdateJwt().then(jwt => {
                    if(this.failed || this._abortRequested){
                        return;
                    }
                    // Update accessKeyId
                    this.service.config.credentials.accessKeyId = jwt;
                    super.finishMultiPart();
                }).catch(err => this.cleanup(err));
            }

            abort(){
                this._abortRequested = true;
                return PydioApi.getRestClient().getOrUpdateJwt().then(jwt => {
                    // Update accessKeyId
                    this.service.config.credentials.accessKeyId = jwt;
                    super.abort();
                }).catch(err => super.cleanup(err));
            }

            cleanup(err){
                this._abortRequested = true;
                return PydioApi.getRestClient().getOrUpdateJwt().then(jwt => {
                    // Update accessKeyId
                    this.service.config.credentials.accessKeyId = jwt;
                    super.cleanup(err);
                }).catch(tokenError => super.cleanup(err || tokenError));
            }

        }

        return {...aws, ManagedMultipart}
    })

}
