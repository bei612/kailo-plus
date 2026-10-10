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

import React from 'react'
import {Checkbox} from 'material-ui'
import {RestDeleteNodesRequest,TreeNode} from 'cells-sdk';
import nativeDelete from './nativeDelete';

class PermanentRemoveCheckbox extends React.Component {
    constructor(props) {
        super(props);
        this.state = {}
    }
    render() {
        const {onChange, messages} = this.props;
        const {checked} = this.state;
        const warning = ': ' + messages['action.delete.permanently.warning']
        return (
            <div style={{marginTop: 16}}>
                <Checkbox
                    onCheck={(e,v) => {this.setState({checked: v}); onChange('removePermanently', v)}}
                    label={messages['action.delete.permanently'] + (checked?warning:'')}
                    labelPosition={"right"}
                    labelStyle={checked?{color: '#f44336'}:{color: 'inherit'}}
                />
            </div>
        );
    }
}

export default function (pydio) {

    const {MessageHash} = pydio;

    return function(){
        let message = MessageHash[176];
        let moreComponents
        const allowPermanentDeletion = pydio.getPluginConfigs("access.gateway").get("DELETE_ALLOW_PERMANENT")
        if (pydio.getContextHolder().getRootNode().getMetadata().get("ws_skip_recycle") === "true"
            || pydio.getContextHolder().getContextNode().getPath().indexOf('/recycle_bin') === 0) {
            message = MessageHash[177];
        } else if (allowPermanentDeletion) {
            moreComponents = {
                removePermanently: (onChange) => <PermanentRemoveCheckbox onChange={onChange} messages={MessageHash}/>
            };
        }
        pydio.UI.openComponentInModal('PydioReactUI', 'ConfirmDialog', {
            message:message,
            dialogTitleId: 7,
            moreComponents,
            validCallback: (moreValues) => {
                const nodes = pydio.getContextHolder().getSelectedNodes();
                const slug = pydio.user.getActiveRepositoryObject().getSlug();
                const deleteRequest = new RestDeleteNodesRequest();
                deleteRequest.Nodes = nodes.map(n => {
                    const t = new TreeNode();
                    t.Path = slug + n.getPath();
                    t.Uuid = n.getMetadata().get('uuid');
                    return t;
                });
                if(moreValues && moreValues.removePermanently) {
                    deleteRequest.RemovePermanently = true;
                }
                nativeDelete(pydio, deleteRequest).then(r => {
                    if (!r) return;
                    if (r.DeleteJobs && r.DeleteJobs.length){
                        nodes.forEach(n => {
                            n.getMetadata().set('pending_operation', r.DeleteJobs[0].Label);
                            n.getMetadata().set('pending_operation_uuid', r.DeleteJobs[0].Uuid);
                            n.notify('meta_replaced', n);
                        })
                    }
                    pydio.getContextHolder().setSelectedNodes([]);
                }).catch(e => {
                    pydio.UI.displayMessage('ERROR', e.Title || e.message);
                });
            }
        });
    };

}
