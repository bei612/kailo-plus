/*
 * Kailo DD-132(2)(3): ONLYOFFICE DocumentServer editing inside the native Cells page.
 * Licensed under the GNU Affero General Public License v3, like Pydio Cells.
 *
 * The WOPI action comes from the Cells server (gateway/restv2/editor-onlyoffice.go,
 * read from the DocumentServer discovery, never built here), the token is the
 * original native document PAT (r/rw from the user's Cells ACL), and the action is
 * opened by a standard WOPI form POST into this page's iframe: the PAT only travels
 * in the form body and is dropped from the component state once submitted.
 * KAILO_DOCUMENT_BINDING switches to governed editing (DD-132(4)): no native PAT then.
 */
import Pydio from 'pydio'
import PydioApi from 'pydio/http/api'
import {RestDocumentAccessTokenRequest, TokenServiceApi} from 'cells-sdk'
import React from 'react'
import {connect} from 'react-redux'
import {referenceDelivery, nativeDocumentSelection, documentBridge} from '../../../../../adapter/src/native-reference.mjs'
import {DOCS_API_CONFIG, editorLocale, kailoPresentation, launchAction, legalNoticeUrl, presentationMessage} from './launch'

const {EditorActions} = Pydio.requireLib('hoc');
const FRAME = 'kailo-onlyoffice-frame';

@connect(null, EditorActions)
export default class Editor extends React.Component {
    constructor(props) {
        super(props);
        this.state = {};
        this.epoch = 0;
        this.form = React.createRef();
    }

    componentDidMount() {
        const {editorModify} = this.props;
        if (this.props.isActive) {
            editorModify({fixedToolbar: true})
        }
        const configs = Pydio.getInstance().getPluginConfigs("editor.onlyoffice");
        try {
            const raw = configs.get("KAILO_DOCUMENT_BINDING");
            if (raw) {
                // A governed binding never issues the unscoped native PAT.
                this.setState({kailoDelivery: referenceDelivery(raw)});
                return;
            }
        } catch (_) { this.setState({referenceError: true}); return; }
        this.publicOrigin = configs.get("ONLYOFFICE_PUBLIC_ORIGIN");
        this.followKailo();
        this.open();
    }

    // DD-132(7)③: Kailo's light/dark switch reaches the open editor without a
    // reload; a locale change applies at the next launch (design 18 §6.2).
    followKailo() {
        const runtime = window.KailoEmbed;
        if (!runtime || typeof runtime.onThemeChange !== 'function') return;
        this.stopKailoTheme = runtime.onThemeChange((theme) => {
            const frame = this.frame && this.frame.contentWindow;
            if (!frame || !this.state.launch || !this.state.launch.submitted) return;
            try {
                frame.postMessage(presentationMessage(theme), this.publicOrigin);
            } catch (_) { /* the next launch carries the theme */ }
        });
    }

    componentWillReceiveProps(nextProps) {
        if (this.props.node !== nextProps.node) {
            this.epoch++;
            if (this.stopDocumentBridge) this.stopDocumentBridge();
            this.setState({launch: null, failed: false, exportingReference: false, referenceError: false});
            if (!this.state.kailoDelivery) this.open(nextProps.node);
        }
        if (nextProps.isActive) {
            this.props.editorModify({fixedToolbar: true})
        }
    }

    componentDidUpdate() {
        const {launch} = this.state;
        if (launch && !launch.submitted && this.form.current) {
            this.form.current.submit();
            // The PAT stays only in the request the browser just sent.
            this.setState({launch: {action: launch.action, submitted: true}});
        }
    }

    componentWillUnmount() {
        this.epoch++;
        if (this.stopDocumentBridge) this.stopDocumentBridge();
        if (this.stopKailoTheme) this.stopKailoTheme();
    }

    async open(node = this.props.node) {
        const pydio = Pydio.getInstance();
        const publicOrigin = this.publicOrigin;
        const epoch = ++this.epoch;
        const nativeUser = pydio.user.id;
        try {
            const native = pydio.getFrontendUrl();
            const origin = `${native.protocol}//${native.host}`;
            const base = new URL(pydio.Parameters.get('ENDPOINT_REST_API_V2'), `${origin}/`);
            if (base.origin !== origin) throw new Error('REST endpoint is not same-origin');
            const jwt = await PydioApi.getRestClient().getOrUpdateJwt();
            const uuid = node.getMetadata().get('uuid');
            const response = await fetch(new URL(`n/node/${encodeURIComponent(uuid)}?Flags=WithEditorURLs`,
                base.href.endsWith('/') ? base : `${base.href}/`), {
                credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: {Authorization: `Bearer ${jwt}`},
            });
            if (!response.ok) throw new Error('node unavailable');
            const value = await response.json();
            const selected = value && value.EditorURLs && value.EditorURLs.onlyoffice && value.EditorURLs.onlyoffice.Url;
            if (!selected) throw new Error('no document editor action');
            const kailo = kailoPresentation(window.KailoEmbed);
            const action = launchAction(selected, publicOrigin,
                kailo ? kailo.locale : editorLocale(pydio.user.getPreference('lang')), kailo ? kailo.theme : undefined);
            const api = new TokenServiceApi(PydioApi.getRestClient());
            const request = new RestDocumentAccessTokenRequest();
            request.Path = PydioApi.getClient().getSlugForNode(node) + node.getPath();
            const token = await api.generateDocumentAccessToken(request);
            if (epoch !== this.epoch || pydio.user.id !== nativeUser || !token.AccessToken) throw new Error('selection changed');
            this.setState({launch: {action, token: token.AccessToken, submitted: false}});
        } catch (_) {
            if (epoch === this.epoch) this.setState({failed: true});
        }
    }

    openInKailo(actionKey) {
        const delivery = this.state.kailoDelivery;
        if (!delivery || this.state.exportingReference) return;
        if (this.stopDocumentBridge) this.stopDocumentBridge();
        const epoch = ++this.epoch;
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
            if (pydio.user.id !== nativeUser || epoch !== this.epoch) throw new Error('native identity or selection changed');
            return value;
        };
        const selection = nativeDocumentSelection(delivery, this.props.node.getMetadata().get('uuid'), actionKey, read);
        // Register before the native reads finish (same order as editor.libreoffice).
        this.stopDocumentBridge = documentBridge(window, opened, delivery, selection);
        selection.catch(() => { if (epoch === this.epoch) { this.stopDocumentBridge(); opened.close(); this.setState({referenceError: true}); } })
            .finally(() => { if (epoch === this.epoch) this.setState({exportingReference: false}); });
    }

    render() {
        const {launch, failed, kailoDelivery, exportingReference, referenceError} = this.state;
        const messages = Pydio.getMessages();
        return (
            <div style={{display: 'flex', flexDirection: 'column', width: '100%', height: '100%'}}>
                {kailoDelivery ? <div>
                    <button disabled={exportingReference} onClick={() => this.openInKailo('file_storage.open_view@v2')}>{messages['onlyoffice.kailo_view']}</button>
                    <button disabled={exportingReference || this.props.node.hasMetadataInBranch('node_readonly', 'true')} onClick={() => this.openInKailo('file_storage.open_edit@v2')}>{messages['onlyoffice.kailo_edit']}</button>
                </div> : null}
                {referenceError ? <div role="alert">{messages['onlyoffice.kailo_reference_unavailable']}</div> : null}
                {failed ? <div role="alert">{messages['onlyoffice.unavailable']}</div> : null}
                {launch && !launch.submitted ? (
                    <form ref={this.form} action={launch.action} method="post" target={FRAME} style={{display: 'none'}}>
                        <input type="hidden" name="access_token" value={launch.token}/>
                        <input type="hidden" name="access_token_ttl" value="0"/>
                        <input type="hidden" name="docs_api_config" value={DOCS_API_CONFIG}/>
                    </form>
                ) : null}
                {launch ? <iframe name={FRAME} ref={(el) => { this.frame = el; }} title={messages['onlyoffice.1']} allow="clipboard-read; clipboard-write; fullscreen"
                    style={{backgroundColor: 'white', width: '100%', height: '100%', border: 0, flex: 1}}/> : null}
                {this.publicOrigin ? (
                    <div style={{fontSize: 12, padding: '2px 8px', textAlign: 'right'}}>
                        <a href={legalNoticeUrl(this.publicOrigin)} target="_blank" rel="noopener noreferrer">{messages['onlyoffice.legal_notices']}</a>
                    </div>
                ) : null}
            </div>
        );
    }
}
