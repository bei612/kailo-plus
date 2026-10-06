/*
 * Copyright 2007-2019 Charles du Jeu - Abstrium SAS <team (at) pyd.io>
 * This file is part of Pydio.
 *
 * Pydio is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Pydio is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Pydio.  If not, see <http://www.gnu.org/licenses/>.
 *
 * The latest code can be found at <https://pydio.com>.
 */
import Pydio from 'pydio'
import PydioApi from 'pydio/http/api'
import {RestDocumentAccessTokenRequest, TokenServiceApi} from 'cells-sdk'
import React, {Component} from 'react'
import {connect} from 'react-redux'
import {referenceDelivery, nativeDocumentSelection, documentBridge} from '../../../../../adapter/src/native-reference.mjs'

const {EditorActions} = Pydio.requireLib('hoc');


@connect(null, EditorActions)
export default class Editor extends React.Component {
    constructor(props) {
        super(props);

        this.state = {}
        this.referenceEpoch = 0;
    }

    componentWillReceiveProps(nextProps) {
        if (this.props.node !== nextProps.node) {
            this.referenceEpoch++;
            if (this.stopDocumentBridge) this.stopDocumentBridge();
            this.setState({exportingReference: false, referenceError: false});
        }
        const {editorModify} = this.props;
        if (nextProps.isActive) {
            editorModify({fixedToolbar: true})
        }
    }

    componentDidMount() {
        const {editorModify} = this.props;
        if (this.props.isActive) {
            editorModify({fixedToolbar: true})
        }
        const pydio = Pydio.getInstance();
        const configs = pydio.getPluginConfigs("editor.libreoffice")
        pydio.notify('longtask_starting');
        // Empty delivery keeps this independent native editor unchanged. The
        // optional link is controlled binding projection metadata, not an ACL.
        try {
            const raw = configs.get("KAILO_DOCUMENT_BINDING");
            if (raw) {
                this.setState({kailoDelivery: referenceDelivery(raw)});
                // A governed binding cannot issue the old unscoped native PAT
                // before the HUMAN chooses a platform-admitted protocol action.
                return;
            }
        } catch (_) { this.setState({referenceError: true}); return; }

        const iframeUrl = configs.get("LIBREOFFICE_CODE_VERSION") === "v21" ? "/browser/dist/cool.html" : "/loleaflet/dist/loleaflet.html";
        const frontUrl = pydio.getFrontendUrl();
        const webSocketProtocol = frontUrl.protocol === 'https:' ? 'wss:' : 'ws:';

        const webSocketUrl = `${webSocketProtocol}//${frontUrl.host}`; //host.replace(/^http/gi, 'ws');
        // Check current action state for permission
        const {node} = this.props;
        const readonly = node.hasMetadataInBranch("node_readonly", "true") || (node.getMetadata().get("content_lock") && node.getMetadata().get("content_lock") !== pydio.user.id);
        const permission = readonly ? "readonly" : "edit"
        const uri = "/wopi/files/" + node.getMetadata().get("uuid");
        const fileSrcBaseUrl = configs.get("LIBREOFFICE_INTERNAL_CELLS_BASE_URL") || `${frontUrl.protocol}//${frontUrl.host}`;
        const fileSrcUrl =encodeURIComponent(`${fileSrcBaseUrl}${uri}`);


        const api = new TokenServiceApi(PydioApi.getRestClient())
        const req = new RestDocumentAccessTokenRequest();
        req.Path = PydioApi.getClient().getSlugForNode(node) + node.getPath();
        let langParam = '';
        if(pydio.user.getPreference('lang')) {
            let lang = pydio.user.getPreference('lang')
            if(lang !== 'zh-cn' &&  lang.split) {
                lang = lang.split('-')[0]
            }
            langParam = `&lang=${lang}`
        }
        api.generateDocumentAccessToken(req).then(response => {
            this.setState({url: `${iframeUrl}?host=${webSocketUrl}&WOPISrc=${fileSrcUrl}&access_token=${response.AccessToken}&permission=${permission}${langParam}`});
        })
    }

    componentWillUnmount() {
        this.referenceEpoch++;
        if (this.stopDocumentBridge) this.stopDocumentBridge();
        Pydio.getInstance().notify('longtask_finished');
    }

    openInKailo(actionKey) {
        const delivery = this.state.kailoDelivery;
        if (!delivery || this.state.exportingReference) return;
        if (this.stopDocumentBridge) this.stopDocumentBridge();
        const epoch = ++this.referenceEpoch;
        const opened = window.open(`${delivery.platformOrigin}/app/?protocolBinding=${encodeURIComponent(delivery.bindingId)}`, '_blank');
        if (!opened) { this.setState({referenceError: true}); return; }
        this.setState({exportingReference: true, referenceError: false});
        const pydio = Pydio.getInstance();
        const nativeUser = pydio.user.id;
        const native = pydio.getFrontendUrl();
        const base = new URL(pydio.Parameters.get('ENDPOINT_REST_API_V2'), `${native.protocol}//${native.host}/`);
        if (base.origin !== `${native.protocol}//${native.host}`) {
            opened.close(); this.setState({exportingReference: false, referenceError: true}); return;
        }
        const read = async (path, method, body) => {
            // Same native JWT and original gateway ACL as Cells' own file UI.
            const token = await PydioApi.getRestClient().getOrUpdateJwt();
            if (pydio.user.id !== nativeUser) throw new Error('native identity changed');
            const response = await fetch(new URL(path, base.href.endsWith('/') ? base : `${base.href}/`), {
                method, credentials: 'same-origin', redirect: 'error', cache: 'no-store',
                headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            if (!response.ok) throw new Error('native reference unavailable');
            const value = await response.json();
            if (pydio.user.id !== nativeUser || epoch !== this.referenceEpoch) throw new Error('native identity or selection changed');
            return value;
        };
        const selection = nativeDocumentSelection(delivery, this.props.node.getMetadata().get('uuid'), actionKey, read);
        // Register before the native reads finish; a fast authenticated Kailo
        // receiver can send Ready while the reference is still being checked.
        this.stopDocumentBridge = documentBridge(window, opened, delivery, selection);
        selection.catch(() => { if (epoch === this.referenceEpoch) { this.stopDocumentBridge(); opened.close(); this.setState({referenceError: true}); } })
            .finally(() => { if (epoch === this.referenceEpoch) this.setState({exportingReference: false}); });
    }

    render() {
        const {url, kailoDelivery, exportingReference, referenceError} = this.state
        const messages = Pydio.getInstance().getMessages();
        return (
            <div style={{display: 'flex', flexDirection: 'column', width: '100%', height: '100%'}}>
                {kailoDelivery ? <div>
                    <button disabled={exportingReference} onClick={() => this.openInKailo('file_storage.open_view@v1')}>{messages['libreoffice.kailo_view']}</button>
                    <button disabled={exportingReference || this.props.node.hasMetadataInBranch('node_readonly', 'true')} onClick={() => this.openInKailo('file_storage.open_edit@v1')}>{messages['libreoffice.kailo_edit']}</button>
                </div> : null}
                {referenceError ? <div role="alert">{messages['libreoffice.kailo_reference_unavailable']}</div> : null}
                {url ? <iframe src={url} style={{backgroundColor: "white", width: "100%", height: "100%", border: 0, flex: 1}}></iframe> : null}
            </div>
        );
    }
}
