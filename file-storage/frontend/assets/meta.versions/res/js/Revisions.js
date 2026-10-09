/*
 * Copyright 2007-2017 Charles du Jeu - Abstrium SAS <team (at) pyd.io>
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

import React, {Component, Fragment} from 'react'
import Pydio from 'pydio'
const PydioApi = require('pydio/http/api');
import MetaNodeProvider from 'pydio/model/meta-node-provider'
const Node = require('pydio/model/node');
import Markdown from 'react-markdown';
const {Timeline, UserAvatar} = Pydio.requireLib('components');
const {moment} = Pydio.requireLib('boot')
import PathUtils from 'pydio/util/path'
import debounce from 'lodash.debounce'

const UserLinkWrapper = ({href, children}) => {
    if (href.startsWith('user://')) {
        const userId = href.replace('user://', '');
        return (
            <UserAvatar
                userId={userId}
                displayAvatar={false}
                richOnClick={false}
                style={{display:'inline-block', fontWeight: 500}}
                pydio={Pydio.getInstance()}
            />)
    }
    return <span>{children}</span>
};

const Paragraph = ({children}) => <span>{children}</span>;

const CustomComponents = {
    a:({node, ...props}) => UserLinkWrapper(props),
    p:({node, ...props}) => Paragraph(props),
}

class Revisions extends Component {

    constructor(props) {
        super(props);
        this.state = {
            loading: true,
            revs: [],
            selection: props.preselection
        }
        this._loadEpoch = 0;
        this._bload = debounce(this.load.bind(this), 1500)
        this._nodeReplaced = () => {
            if(this._disposed) {
                return;
            }
            this._loadEpoch++;
            this._loadedScope = null;
            this.setState({loading: true, revs: [], empty: false});
            this._bload();
        };
    }

    componentDidMount() {
        this.props.node.observe('node_replaced', this._nodeReplaced);
        this.load();
    }

    componentWillUnmount() {
        this._disposed = true;
        this._loadEpoch++;
        this._loadedScope = null;
        this._bload.cancel();
        this.props.node.stopObserving('node_replaced', this._nodeReplaced);
    }

    componentDidUpdate(prevProps, prevState, snapshot) {
        if(prevProps.node !== this.props.node) {
            this._bload.cancel();
            if(prevProps.node) {
                prevProps.node.stopObserving('node_replaced', this._nodeReplaced)
            }
            if(this.props.node) {
                this.props.node.observe('node_replaced', this._nodeReplaced)
            }
            this.load()
        }
    }


    getMessage(id){
        return Pydio.getMessages()['meta.versions.' + id] || id;
    }

    isCurrentScope(scope) {
        return !this._disposed && scope && scope.epoch === this._loadEpoch && scope.node === this.props.node &&
            PydioApi.getClient().isVersionTargetCurrent(scope.node, scope.target);
    }

    load() {
        if(this._disposed) {
            return;
        }
        const {node} = this.props;
        const epoch = ++this._loadEpoch;
        this._loadedScope = null;
        this.setState({loading: true, revs: [], empty: false, selection: this.props.preselection});
        let target;
        try {
            target = PydioApi.getClient().getVersionTarget(node);
        } catch (error) {
            this.setState({loading: false});
            Pydio.getInstance().UI.displayMessage('ERROR', error.message || error);
            return;
        }
        const scope = {node, epoch, target};
        const providerProps = {versions:'true',file:target.path, silent:true, tmp_repository_id:target.repositoryId}
        const provider = new MetaNodeProvider(providerProps);
        const versionsRoot = new Node("/", false, "Versions", "folder.png", provider);
        provider.loadNode(versionsRoot, (n) => {
            if(!this.isCurrentScope(scope)) {
                return;
            }
            const revs = [];
            n.getChildren().forEach(c => revs.push(c));
            this._loadedScope = scope;
            this.setState({loading: false, revs, empty: !revs.length});
        }, null, false, -1, {errorHandler: error => {
            if(this.isCurrentScope(scope)) {
                this.setState({loading: false});
                Pydio.getInstance().UI.displayMessage('ERROR', error.message || error);
            }
        }})
    }

    applyAction(action, versionNode){
        const scope = this._loadedScope;
        if(!this.isCurrentScope(scope) || !this.state.revs.includes(versionNode)) {
            return;
        }
        const {node, onRequestClose} = this.props;
        switch(action){
            case 'dl':
                PydioApi.getClient().openVersion(node, versionNode.getMetadata().get('versionId'));
                break;
            case 'revert':
                if(!confirm(this.getMessage('13'))){
                    return;
                }
                if(!this.isCurrentScope(scope)) {
                    return;
                }
                PydioApi.getClient().revertToVersion(node, versionNode.getMetadata().get('versionId'), ()=>{
                    if(this.isCurrentScope(scope) && onRequestClose) {
                        onRequestClose();
                    }
                });
                break;
            default:
                break;
        }
    }

    itemActions(item, prev, next) {
        if(prev) {
            return [
                {onClick:() => this.applyAction('dl', item), label:this.getMessage('3')},
                {onClick:() => this.applyAction('revert', item), label:this.getMessage('7')}
            ]
        } else {
            return []
        }
    }

    itemAnnotations(item, prev, next) {
        let arrow
        const size = parseInt(item.getMetadata().get('bytesize'));
        if(next){
            const nextSize = parseInt(next.getMetadata().get('bytesize'));
            if(nextSize === size){
                arrow = 'right'
            } else  if(nextSize > size){
                arrow = 'bottom-right'
            } else {
                arrow = 'top-right'
            }
        }
        return (
            <div className={"tl-annotation"}>{arrow && <span className={"tl-annotation-dir mdi mdi-arrow-" + arrow}/>}{PathUtils.roundFileSize(size)}</div>
        )
    }

    render() {
        const {loading, revs, selection, empty} = this.state;
        if (loading) {
            return <div style={{textAlign:'center', fontWeight: 500, opacity: 0.3, padding: 20}}>{Pydio.getMessages()['466']}</div>
        } else if (empty) {
            return <div style={{textAlign:'center', fontWeight: 500, opacity: 0.3, padding: 20, paddingBottom: 30}}>{this.getMessage('14')}</div>
        }
        const {className='', onClick} = this.props;

        return (
            <Timeline
                items={revs}
                className={className}
                useSelection={true}
                preSelection={selection}
                onItemSelect={onClick}
                itemUuid={(item) => item.getMetadata().get("versionId")}
                itemMoment={(item) => moment(item.getMetadata().get('ajxp_modiftime')*1000)}
                itemDesc={(item) => <Markdown urlTransform={(u)=>u} components={CustomComponents}>{item.getMetadata().get('versionDescription')}</Markdown>}
                itemActions={this.itemActions.bind(this)}
                itemAnnotations={this.itemAnnotations.bind(this)}
                itemClassName={(item)=> (revs && revs.indexOf(item) === 0) ? 'current-revision': ''}
                color={"#2196f3"}
            />
        )

    }

}

export default Revisions;
