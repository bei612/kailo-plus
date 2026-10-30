import Pydio from 'pydio'
import DOMUtils from 'pydio/util/dom'

const pydio = Pydio.getInstance()

class Callbacks{

    static share(){
        // DD-164(4): in Kailo mode sharing is Kailo's (KailoCells.kailoShare
        // hands the folder to the Kailo share dialog); never the native dialog.
        const kailo = window.KailoCells;
        if(kailo && kailo.kailoMode && kailo.kailoMode() && kailo.kailoShare){
            kailo.kailoShare(pydio.getUserSelection().getUniqueNode());
            return;
        }
        const props = {pydio:pydio, selection:pydio.getUserSelection()};
        if(DOMUtils.getViewportWidth() < 700) {
            props.dialogSize = 'md';
            props.editorOneColumn = true;
        }
        pydio.UI.openComponentInModal('ShareDialog', 'CompositeDialog', props);
    }

    static editShare(){
        Callbacks.share();
    }

    static loadList(){
        if(window.actionManager){
            window.actionManager.getDataModel().requireContextChange(window.actionManager.getDataModel().getRootNode(), true);
        }
    }

    static editFromList(){
        let dataModel;
        if(window.actionArguments && window.actionArguments.length){
            dataModel = window.actionArguments[0];
        }else if(window.actionManager){
            dataModel = window.actionManager.getDataModel();
        }
        pydio.UI.openComponentInModal('ShareDialog', 'MainPanel', {pydio:pydio, readonly:true, selection:dataModel});
    }

    static openUserShareView(){

        pydio.UI.openComponentInModal('ShareDialog', 'ShareViewModal', {
            pydio:pydio,
            currentUser:true,
            filters:{
                parent_repository_id:"250",
                share_type:"share_center.238"
            }
        });

    }

}

class Listeners{}
export {
    Callbacks,
    Listeners
}