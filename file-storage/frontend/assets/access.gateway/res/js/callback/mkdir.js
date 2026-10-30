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


import PydioApi from "pydio/http/api";
import LangUtils from 'pydio/util/lang';
const {PromptValidators} = Pydio.requireLib('boot')
import {TreeServiceApi, RestCreateNodesRequest, TreeNode, TreeNodeType} from 'cells-sdk';

// A free name next to the existing children: "新建文件夹", "新建文件夹 2", ...
export function freeName(base, existing) {
    const taken = new Set((existing || []).map(n => String(n).toLowerCase()))
    if (!taken.has(base.toLowerCase())) {
        return base
    }
    let i = 2
    while (taken.has((base + ' ' + i).toLowerCase())) {
        i++
    }
    return base + ' ' + i
}

// DD-167 (07 §4.8.10): in Kailo mode the name is asked in Kailo's dialog
// (KailoEmbed.prompt; the page's own Kailo dialog at top level) and the
// result is reported through Kailo's toast: created, or why not.
export function kailoMkdir(pydio, kailo, api) {
    const context = pydio.getContextNode()
    const siblings = []
    context.getChildren().forEach(c => siblings.push(c.getLabel()))
    const asked = kailo.askName({
        title: kailo.text('mkdir'),
        label: kailo.text('mkdirLabel'),
        value: freeName(kailo.text('mkdirDefault'), siblings),
        confirmLabel: kailo.text('mkdirConfirm'),
        cancelLabel: kailo.text('cancel'),
        maxLength: 255,
    })
    return Promise.resolve(asked).then(value => {
        const name = String(value || '').trim()
        if (!name) {
            return null
        }
        if (!kailo.validName(name)) {
            pydio.UI.displayMessage('ERROR', kailo.failure('mkdirFailed', kailo.text('mkdirInvalid')))
            return null
        }
        if (siblings.some(l => String(l).toLowerCase() === name.toLowerCase())) {
            pydio.UI.displayMessage('ERROR', kailo.text('mkdirExists', name))
            return null
        }
        const request = new RestCreateNodesRequest();
        const slug = pydio.user.getActiveRepositoryObject().getSlug();
        const node = new TreeNode();
        node.Path = slug + LangUtils.trimRight(context.getPath(), '/') + '/' + name;
        node.Type = TreeNodeType.constructFromObject('COLLECTION');
        request.Nodes = [node];
        return api.createNodes(request).then(() => {
            pydio.UI.displayMessage('SUCCESS', kailo.text('mkdirDone', name))
            return name
        }).catch(e => {
            pydio.UI.displayMessage('ERROR', kailo.failure('mkdirFailed', e && (e.Title || e.message)))
            return null
        })
    })
}

export default function(pydio){

    return function(){

        const kailo = window.KailoCells
        if (kailo && kailo.kailoMode && kailo.kailoMode() && kailo.askName) {
            // Silent client: the failure is reported once, in Kailo's words.
            kailoMkdir(pydio, kailo, new TreeServiceApi(PydioApi.getRestClient({silent: true})))
            return
        }

        const validators = [
            PromptValidators.Empty,
            PromptValidators.NoSlash,
            PromptValidators.MustDifferSiblings(),
        ]

        let submit = value => {

            if(value.indexOf('/') !== -1) {
                const m = pydio.MessageHash['filename.forbidden.slash'];
                pydio.UI.displayMessage('ERROR', m);
                throw new Error(m);
            }

            const api = new TreeServiceApi(PydioApi.getRestClient());
            const request = new RestCreateNodesRequest();
            const slug = pydio.user.getActiveRepositoryObject().getSlug();
            const path = slug + LangUtils.trimRight(pydio.getContextNode().getPath(), '/') + '/' + value;
            const node = new TreeNode();
            node.Path = path;
            node.Type = TreeNodeType.constructFromObject('COLLECTION');
            request.Nodes = [node];
            api.createNodes(request).then(collection => {
                if(console) console.debug('Created nodes', collection.Children);
            });
        };
        pydio.UI.openComponentInModal('PydioReactUI', 'PromptDialog', {
            dialogTitleId:154,
            legendId:155,
            fieldLabelId:173,
            dialogSize:'sm',
            submitValue:submit,
            warnSpace: true,
            validate:(value) => {
                validators.forEach(v => v(value))
            }
        });
    }

}