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

import React, {createRef} from 'react';
import Pydio from 'pydio';
import {debounce} from 'lodash'
const {withSearch, emptyDataModel} = Pydio.requireLib('hoc')
const {PromptValidators} = Pydio.requireLib('boot')
import Action from 'pydio/model/action'
import PydioDataModel from 'pydio/model/data-model'
import {muiThemeable} from 'material-ui/styles'
import {MainFilesListV2} from './MainFilesListV2'
import MainFilesList from './MainFilesList'
import EditionPanel from './EditionPanel'
import WelcomeTour from './WelcomeTour'
import {CellChatDetached} from './CellChat'
import MasterLayout from './MasterLayout'
import AppBar from './AppBar'
import WorkspacesList from "../wslist/WorkspacesList";
import {MUITour} from "./WelcomeMuiTour";
import {MultiColumnPanel} from "../detailpanes/MultiColumnPanel";
import genUuid from 'uuid4'
import AppBarRight from "./AppBarRight";
import {ModalSearch} from "../search/ModalSearch";
import {workspaceChatShown} from "./kailoChat";
import KailoToolbar from "../kailo/KailoToolbar";
import KailoFilesFooter from "../kailo/KailoFilesFooter";
import KailoTopHeader from "../kailo/KailoTopHeader";
import KailoFavorites from "../kailo/KailoFavorites";
import {requestPageSize, storedPageSize} from "../kailo/paging";

const CurrentTemplateKey = 'FSTemplate'
const TemplatesKey = 'FSTemplatePresets'

class FSTemplate extends React.Component {

    constructor(props){
        super(props);
        this.state = {
            ...this.stateFromPrefs(),
            drawerOpen: false,
            searchFormState: {},
            searchView: false,
            modalSearchDM: emptyDataModel(),
        };
        this.parentRef = createRef()
    }

    stateFromPrefs() {
        const {pydio} = this.props
        const uPref = (k, v) => {
            return pydio.user ? pydio.user.getLayoutPreference(k, v) : v
        }
        // DD-157 (20 §13.3): in Kailo mode the space chat is a docked side panel,
        // never a floating window with window controls.
        const kailo = typeof window !== 'undefined' && window.KailoCells
        const kailoMode = !!(kailo && kailo.kailoMode && kailo.kailoMode())
        return {
            // DD-167 (20 §15.1): in Kailo mode the details panel shows for a selection
            // (its toggle stays on by default); without a selection the list is full width.
            kailoInfoOpen: uPref('FSTemplate.Kailo.InfoPanel', true),
            infoPanelOpen: uPref('FSTemplate.infoPanelOpen', true), // open by default
            chatOpen: uPref('FSTemplate.chatOpen', false), // closed by default
            chatDetached: kailoMode ? false : uPref('FSTemplate.chatDetached', true), // detached by default
            kailoMode,
        }
    }

    setSearchView() {
        const {pydio} = this.props
        const {searchView} = this.state;
        if(!searchView) {
            this.setState({searchViewTransition: true})
        }
        const dm = pydio.getContextHolder();
        dm.setSelectedNodes([]);
        if(dm.getContextNode() !== dm.getSearchNode()){
            this.setState({previousContext: dm.getContextNode()})
        }
    }

    unsetSearchView(){
        const {pydio} = this.props;
        const {searchView} = this.state;
        if(searchView) {
            this.setState({searchViewTransition: true})
        }
        const dm = pydio.getContextHolder();
        const {previousContext} = this.state;
        dm.setSelectedNodes([]);
        const ctxNode = previousContext || dm.getRootNode()
        dm.setContextNode(ctxNode, true);
        this.setState({previousContext: null});
    }

    componentDidMount(){
        const {pydio} = this.props;
        const resizeTrigger = debounce(()=>{
            window.dispatchEvent(new Event('resize'));
            this.setState({searchViewTransition: false})
        }, 350)
        this._ctxObserver = ()=>{
            const searchView = pydio.getContextHolder().getContextNode() === pydio.getContextHolder().getSearchNode()
            if(searchView !== this.state.searchView) {
                this.setState({searchView, searchViewTransition: true}, resizeTrigger)
            }
        }
        this._prefObserver = ({path, value}) => {
            if(!path || path.indexOf(CurrentTemplateKey +'.') !== 0) {
                return
            }
            // If a template is currently in use, update it
            const presets = pydio.user.getLayoutPreference(TemplatesKey, [])
            const currents = presets.filter(p => p.current)
            if(!currents.length) {
                return
            }
            const current = currents[0]
            const newPayload = pydio.user.getLayoutPreference(CurrentTemplateKey)
            presets.forEach(p => {
                if(p.id === current.id) {
                    p.payload = newPayload
                }
            })
            pydio.user.setLayoutPreference(TemplatesKey, presets)
        };
        this._reloadPrefObserver = () => {
            this.setState(this.stateFromPrefs())
        }
        pydio.getController().updateGuiActions(this.getPydioActions());
        // DD-157: Kailo's header opens the native share dialog for one node; the
        // app bar follows when Kailo's answer changes who draws the header.
        const kailo = window.KailoCells
        if(kailo && kailo.onPageHosted) {
            this._stopPageHosted = kailo.onPageHosted(() => this.forceUpdate())
        }
        if(kailo && kailo.setShareOpener) {
            kailo.setShareOpener((node) => {
                const selection = new PydioDataModel(true)
                selection.setSelectedNodes([node])
                pydio.UI.openComponentInModal('ShareDialog', 'CompositeDialog', {pydio, selection})
            })
        }
        if(this.state.kailoMode) {
            const dm = pydio.getContextHolder()
            this._selObserver = () => {
                const selected = dm.getSelectedNodes().length
                if((selected > 0) !== !!this.state.hasSelection) {
                    this.setState({hasSelection: selected > 0}, () => this.resizeAfterTransition())
                }
            }
            dm.observe('selection_changed', this._selObserver)
            if(kailo && kailo.onListPane) {
                this._stopListPane = kailo.onListPane((pane) => this.setState({kailoPane: pane}))
            }
            if(kailo && kailo.onPageHosted) {
                // Top level vs inside Kailo can change once Kailo answered.
                this._stopHosted2 = kailo.onPageHosted(() => this.forceUpdate())
            }
        }
        pydio.observe('context_changed', this._ctxObserver)
        pydio.observe('set_layout_preference', this._prefObserver)
        pydio.observe('reload_layout_preferences', this._reloadPrefObserver)
    }

    componentWillUnmount(){
        const {pydio} = this.props;
        if(this._stopPageHosted) {
            this._stopPageHosted()
        }
        if(this._selObserver) {
            pydio.getContextHolder().stopObserving('selection_changed', this._selObserver)
        }
        if(this._stopListPane) {
            this._stopListPane()
        }
        if(this._stopHosted2) {
            this._stopHosted2()
        }
        pydio.stopObserving('context_changed', this._ctxObserver)
        pydio.stopObserving('set_layout_preference', this._prefObserver)
        pydio.stopObserving('reload_layout_preferences', this._reloadPrefObserver)
        this.getPydioActions(true).map(function(key){
            pydio.getController().deleteFromGuiActions(key);
        }.bind(this));
    }

    toggleAndStore(keyName, prefKey) {
        const value = this.state[keyName]
        const newValue = !value;
        const {pydio} = this.props;
        this.setState({[keyName]: newValue}, ()=> {
            this.resizeAfterTransition()
            pydio.user.setLayoutPreference(prefKey || ('FSTemplate.' + keyName), !!newValue)
        })
    }

    toggleRightPanel(name){
        this.toggleAndStore(name === 'chat' ? 'chatOpen' : 'infoPanelOpen')
    }


    resizeAfterTransition(){
        if(this.parentRef.current) {
            this.setState({parentWidth: this.parentRef.current.offsetWidth})
        }
        setTimeout(() => { window.dispatchEvent(new Event('resize')) }, 250);
        setTimeout(() => { window.dispatchEvent(new Event('resize')) }, 500);
    }

    infoPanelContentChange(numberOfCards){
        //this.setState({infoPanelOpen: (numberOfCards > 0)}, () => this.resizeAfterTransition())
    }

    openDrawer(event){
        event.stopPropagation();
        this.setState({drawerOpen: true});
    }



    buildLayoutActions() {
        //{name, icon_class, callback (), highlight ()}
        const {pydio} = this.props;
        if(!pydio.user) {
            return []
        }

        const save = (k, v) => pydio.user.setLayoutPreference(k, v)
        const labelPrompt = (defaultValue, submitValue) => {
            pydio.UI.openComponentInModal('PydioReactUI', 'PromptDialog', {
                dialogTitleId:'ajax_gui.layouts.prompt.save',
                fieldLabelId:'ajax_gui.layouts.prompt.save.field',
                validate:PromptValidators.Empty,
                defaultValue,
                submitValue
            });
        }
        const confirmPrompt = (message, validCallback) => {
            pydio.UI.openComponentInModal('PydioReactUI', 'ConfirmDialog', {
                message,
                validCallback
            })
        }

        const presets = [...pydio.user.getLayoutPreference(TemplatesKey, [])]
        const actions = presets.map(({id, label, current, payload}) => {
            const use =()=>{
                const newPresets = [...presets]
                newPresets.forEach(p => p.current = p.id === id)
                save(CurrentTemplateKey, payload)
                save(TemplatesKey, newPresets)
                pydio.notify('reload_layout_preferences')
            }

            if(current) {
                return {
                    name: label,
                    icon_class:'mdi mdi-check',
                    subMenu:[
                        {
                            text:pydio.MessageHash['ajax_gui.layouts.action.rename'],
                            iconClassName:'mdi mdi-view-dashboard-edit-outline',
                            payload:()=>{
                                labelPrompt(label, (value) => {
                                    // update label in-place
                                    presets.forEach(p => {
                                        if(p.id === id) {
                                            p.label = value
                                        }
                                    })
                                    save(TemplatesKey, presets)
                                })
                            }
                        },
                        {
                            text:pydio.MessageHash['ajax_gui.layouts.action.reset'],
                            iconClassName:'mdi mdi-eraser',
                            payload:()=>{
                                confirmPrompt(pydio.MessageHash['ajax_gui.layouts.action.reset.confirm'], () => {
                                    presets.forEach(p => {
                                        if(p.id === id) {
                                            p.payload = {}
                                        }
                                    })
                                    save(CurrentTemplateKey, {})
                                    save(TemplatesKey, presets)
                                    pydio.notify('reload_layout_preferences')
                                })
                            }
                        },
                        {
                            text:pydio.MessageHash['ajax_gui.layouts.action.remove'],
                            iconClassName:'mdi mdi-delete-outline',
                            payload:()=>{
                                confirmPrompt(pydio.MessageHash['ajax_gui.layouts.action.remove.confirm'], ()=>{
                                    save(TemplatesKey, [...presets.filter(p => p.id !== id)])
                                })
                            }
                        },
                    ]
                }
            } else {
                return {
                    name: label,
                    icon_class: 'mdi mdi-view-dashboard-outline',
                    callback: use
                }
            }
        })
        if(!presets.length) {
            actions.push({
                name:pydio.MessageHash['ajax_gui.layouts.action.reset'],
                icon_class:'mdi mdi-eraser',
                callback:() => {
                    confirmPrompt(pydio.MessageHash['ajax_gui.layouts.action.reset.confirm'], (value) => {
                        save(CurrentTemplateKey, {})
                        pydio.notify('reload_layout_preferences')
                    });
                }
            })
        }
        actions.push({
            name:pydio.MessageHash['ajax_gui.layouts.action.' + (presets.length ? 'fork': 'create')],
            icon_class:'mdi mdi-content-save',
            callback:() => {
                labelPrompt(pydio.MessageHash['ajax_gui.layouts.action.create.default'], (value) => {
                    const current = JSON.parse(JSON.stringify(pydio.user.getLayoutPreference(CurrentTemplateKey, {})))
                    const preset = {id:genUuid(), label:value, current: true, payload: current}
                    save(TemplatesKey, [...presets.map(p => {return {...p, current: false}}), preset])
                });
            }
        })
        return actions
    }

    getPydioActions(keysOnly = false) {
        if(keysOnly) {
            return ['manage_layouts_preferences']
        }
        const actions = new Map()
        const manageAction = new Action({
            name:'manage_layouts_preferences',
            icon_class:'mdi mdi-view-list',
            text_id:'ajax_gui.layouts.preferences',
            title_id:'ajax_gui.layouts.preferences.legend',
            text:Pydio.getMessages()['ajax_gui.layouts.preferences'],
            title:Pydio.getMessages()['ajax_gui.layouts.preferences.legend'],
            hasAccessKey:false,
            subMenu:true,
            subMenuUpdateImage:true,
            weight:500
        }, {
            selection:false,
            dir:true,
            actionBar:true,
            actionBarGroup:'display_toolbar',
            contextMenu:false,
            infoPanel:false
        }, {}, {}, {
            dynamicBuilder: this.buildLayoutActions.bind(this),
        })
        actions.set('manage_layouts_preferences', manageAction)
        return actions
    }

    // DD-167 (20 §15.1): the Kailo-mode files page. Kailo (or, at top level,
    // the page itself in Kailo style) draws the header and tabs; the location
    // pane is on the left; the content is toolbar 44 + list + pagination bar,
    // with the details panel docked on the right for a selection.
    kailoView(mode) {
        const {pydio} = this.props
        const node = pydio.getContextHolder().getContextNode()
        const target = mode === 'grid' ? 'grid-160' : 'detail'
        pydio.user.setLayoutPreference('FSTemplate.FilesList.DisplayMode', target)
        pydio.notify('reload_layout_preferences')
        // The page size follows the view (20/50/100 or 24/48/96).
        if(node && node.isLoaded && node.isLoaded() && pydio.getContextHolder().getSearchNode() !== node) {
            requestPageSize(pydio.getContextHolder(), node, storedPageSize(pydio, mode === 'grid' ? 'grid' : 'list'))
        }
    }

    kailoSearch(term) {
        const {searchTools} = this.props
        searchTools.setValues({basenameOrContent: term, scope: 'previous_context'})
    }

    renderKailo({styles, style, props, ListComponent, searchView, searchTools, leftPanelProps, tutorialComponent, displayMode, sortingInfo, parentWidth, rightAdditionalTemplates}) {
        const {pydio, muiTheme} = this.props
        const kailo = window.KailoCells
        const hosted = !!(kailo && kailo.pageHosted && kailo.pageHosted())
        const pane = (kailo && kailo.listPane && kailo.listPane()) || 'files'
        const {drawerOpen, kailoInfoOpen, hasSelection, listBusy} = this.state
        const dm = pydio.getContextHolder()
        const homepage = pydio.user && pydio.user.activeRepository === 'homepage'
        const repo = pydio.user ? pydio.user.getActiveRepositoryObject() : null
        const ctx = dm.getContextNode()
        const locationName = ctx && ctx.getPath && ctx.getPath() !== '/' && ctx.getPath() !== '' ? ctx.getLabel() : (repo ? ((kailo.locationLabel && kailo.locationLabel(repo.getSlug())) || repo.getLabel()) : '')
        const infoVisible = !!kailoInfoOpen && !!hasSelection && pane !== 'bookmarks'
        const kailoLeftProps = {...leftPanelProps, closed: leftPanelProps.closed && !searchView}
        const header = hosted ? null : <KailoTopHeader/>
        let content
        if(pane === 'bookmarks' && !homepage) {
            content = <KailoFavorites pydio={pydio}/>
        } else {
            const mainToolbars = ["change_main", "info_panel", "info_panel_share", "info_panel_edit_share"]
            const {Toolbar} = Pydio.requireLib('components')
            const selectionToolbar = hasSelection ? (
                <Toolbar
                    pydio={pydio}
                    id="main-toolbar"
                    toolbars={mainToolbars}
                    groupOtherList={["change", "other"]}
                    renderingType="button"
                    toolbarStyle={{overflow:'hidden'}}
                    flatButtonStyle={styles.flatButtonStyle}
                    buttonStyle={styles.flatButtonLabelStyle}
                />
            ) : null
            const view = String(displayMode || '').indexOf('grid') === 0 ? 'grid' : 'list'
            content = (
                <div className="kailo-files-page">
                    <KailoToolbar
                        locationName={searchView ? '' : locationName}
                        searchView={searchView}
                        searchTerm={searchView && searchTools.values ? searchTools.values.basenameOrContent : ''}
                        onSearch={(term) => this.kailoSearch(term)}
                        onClearSearch={() => searchView && this.unsetSearchView()}
                        selectionToolbar={selectionToolbar}
                        view={view}
                        onView={searchView ? null : (mode) => this.kailoView(mode)}
                        sortingInfo={sortingInfo}
                        onSort={searchView ? null : (key) => pydio.notify('kailo_sort_request', key)}
                        infoOpen={kailoInfoOpen}
                        onToggleInfo={() => this.toggleAndStore('kailoInfoOpen', 'FSTemplate.Kailo.InfoPanel')}
                    />
                    <div className="kailo-files-body" ref={this.parentRef}>
                        <div className={"kailo-list-column" + (listBusy ? " kailo-list-busy" : "")}>
                            <ListComponent
                                ref="list"
                                key={searchView?"search-results":"files-list"}
                                pydio={pydio}
                                dataModel={dm}
                                searchResults={searchView}
                                searchScope={searchTools.values ? searchTools.values.scope : null}
                                searchLoading={searchTools.searchLoading}
                                searchEmpty={searchTools.empty}
                                onDisplayModeChange={(dMode) => this.setState({displayMode: dMode})}
                                onSortingInfoChange={(si) => {
                                    const {sortingInfo={}} = this.state;
                                    if(sortingInfo.attribute !== si.attribute || sortingInfo.direction !== si.direction) {
                                        this.setState({sortingInfo: si})
                                    }
                                }}
                                style={{flex: 1, minHeight: 0}}
                            />
                            <KailoFilesFooter
                                pydio={pydio}
                                dataModel={dm}
                                displayMode={displayMode}
                                searchView={searchView}
                                searchTools={searchTools}
                                onBusy={(busy) => { if(busy !== !!this.state.listBusy) { this.setState({listBusy: busy}) } }}
                            />
                        </div>
                        <MultiColumnPanel
                            {...props}
                            closed={!infoVisible}
                            afterResize={()=>this.resizeAfterTransition()}
                            storageKey={'FSTemplate.MultiColumn.InfoPanel'}
                            dataModel={dm}
                            onRequestClose={()=>{this.toggleAndStore('kailoInfoOpen', 'FSTemplate.Kailo.InfoPanel')}}
                            onContentChange={this.infoPanelContentChange.bind(this)}
                            style={{...styles.infoPanel.masterStyle}}
                            mainEmptyStateProps={{
                                iconClassName:'',
                                primaryTextId:'ajax_gui.infopanel.empty.select.file',
                                style:{minHeight: 180, backgroundColor: 'transparent', padding:'0 20px'}
                            }}
                            additionalTemplates={rightAdditionalTemplates}
                            parentWidth={parentWidth}
                        />
                    </div>
                </div>
            )
        }
        return (
            <MasterLayout
                pydio={pydio}
                style={{...style, ...styles.masterStyle}}
                classes={['vertical_fit', 'react-fs-template', 'kailo-fs-template', 'display-mode-' + displayMode]}
                tutorialComponent={tutorialComponent}
                drawerOpen={drawerOpen}
                leftPanelProps={kailoLeftProps}
                kailoHeader={header}
                onCloseDrawerRequested={()=>{this.setState({drawerOpen:false})}}
            >
                {content}
                <EditionPanel {...props}/>
            </MasterLayout>
        )
    }

    render () {

        const {muiTheme, pydio} = this.props;

        const {breakpoint = 'md', userTheme} = muiTheme;
        const smallScreen = (breakpoint==='s'|| breakpoint==='xs'), xtraSmallScreen = (breakpoint === 'xs')

        const wTourEnabled = pydio.getPluginConfigs('gui.ajax').get('ENABLE_WELCOME_TOUR');
        const dm = pydio.getContextHolder();
        const searchView = dm.getContextNode() === dm.getSearchNode();
        const {searchViewTransition, modalSearchDM} = this.state;

        let headerHeight = 72;

        // DD-163: no shared-space chat in Kailo mode (Kailo channels).
        let showChatTab = workspaceChatShown(pydio) && !xtraSmallScreen;
        let showInfoPanel = !xtraSmallScreen;

        if(showChatTab){
            const repo = pydio.user.getRepositoriesList().get(pydio.user.activeRepository);
            if(repo && !repo.getOwner()){
                showChatTab = false;
            }
        }
        let {drawerOpen, infoPanelOpen, chatOpen, chatDetached=true, displayMode, sortingInfo, parentWidth} = this.state;
        if(xtraSmallScreen){
            infoPanelOpen = false
        }

        let classes = ['vertical_fit', 'react-fs-template', 'display-mode-' + displayMode];
        const styles = muiTheme.buildFSTemplate({headerHeight, searchView, rightColumnClosed: !infoPanelOpen, displayMode})

        // Making sure we only pass the style to the parent element
        const {style, ...props} = this.props;

        let tutorialComponent;
        const wTour = pydio.user.getLayoutPreference('WelcomeComponent.Pydio8.TourGuide.FSTemplate', false)
        const wtMUI = pydio.user.getLayoutPreference('WelcomeComponent.MUITour', false)
        if (wTourEnabled && !wTour){
            tutorialComponent = <WelcomeTour pydio={pydio}/>;
        } else if (wTourEnabled && userTheme === 'mui3' && wTour && !wtMUI) {
            // Both tours follow ENABLE_WELCOME_TOUR (off in Kailo, DD-133 §1).
            tutorialComponent = <MUITour pydio={pydio}/>
        }

        let leftPanelProps = {
            headerHeight,
            style:styles.leftPanel.masterStyle,
            railPanelStyle:styles.leftPanel.railPanelStyle,
            closed: searchView || smallScreen,
            drawerOpen,
            userWidgetProps: {
                color: styles.userWidgetStyle.color,
                mergeButtonInAvatar:true,
                popoverDirection:'left',
                actionBarStyle:{
                    marginTop:0
                },
                style:styles.userWidgetStyle
            },
            workspacesListProps:{
                ...styles.leftPanel.workspacesList
            }
        };

        const {searchTools, searchTools:{values, empty, searchLoading}} = this.props;

        if(searchView) {
            // Force not pages on search
            if (displayMode === 'pages') {
                displayMode = 'list'
            }
            leftPanelProps.workspacesListProps = {
                ...leftPanelProps.workspacesListProps,
                searchTools,
                searchView: true
            };
        }

        if(muiTheme.userTheme!=='mui3'){
            styles.searchForm.textField = {color:'white'}
        }
        let rightAdditionalTemplates;
        if(showChatTab && chatOpen && !chatDetached) {
            rightAdditionalTemplates = [{
                COMPONENT: "PydioWorkspaces.CellChatInfoCard",
                WEIGHT: -600,
                PROPS: {onRequestDetachPanel: this.state.kailoMode ? undefined : () => this.toggleAndStore('chatDetached')}
            }];
        }

        // Temporary switch between files list versions
        let ListComponent = MainFilesList
        if (pydio.Registry.findEditorById('editor.bnote') && !this.state.kailoMode) {
            ListComponent = MainFilesListV2
        }

        if(this.state.kailoMode) {
            return this.renderKailo({styles, style, props, ListComponent, searchView, searchTools, leftPanelProps, tutorialComponent, displayMode, sortingInfo, parentWidth, rightAdditionalTemplates})
        }

        return (
            <MasterLayout
                pydio={pydio}
                style={{...style, ...styles.masterStyle}}
                desktopStyle={searchView?{marginLeft: 0}:{}}
                classes={classes}
                tutorialComponent={tutorialComponent}
                drawerOpen={drawerOpen}
                leftPanelProps={leftPanelProps}
                onCloseDrawerRequested={()=>{this.setState({drawerOpen:false})}}
            >
                <AppBar
                    pydio={pydio}
                    muiTheme={muiTheme}
                    styles={styles}

                    displayMode={displayMode}
                    headerHeight={headerHeight}
                    sortingInfo={displayMode!=='detail'&&displayMode!=='masonry'?sortingInfo:null}
                    searchIconButton={true}
                    searchIconCallback={() => document.dispatchEvent(new Event('pydioOpenSearch'))}
                    searchTools={searchTools}
                    // Should be removed
                    searchView={searchView}
                    searchViewTransition={searchViewTransition}
                    onUpdateSearchView={(u) => u?this.setSearchView():this.unsetSearchView()}

                    showChatTab={showChatTab}
                    chatOpen={chatOpen}
                    showInfoPanel={showInfoPanel}
                    infoPanelOpen={infoPanelOpen}
                    onToggleRightPanel={(p) => this.toggleRightPanel(p)}
                    onOpenDrawer={(e)=>this.openDrawer(e)}
                />
                <div style={styles.masterListContainer} ref={this.parentRef}>
                    {searchView &&
                        <WorkspacesList
                            className={"left-panel"}
                            pydio={pydio}
                            showTreeForWorkspace={pydio.user?pydio.user.activeRepository:false}
                            {...leftPanelProps.workspacesListProps}
                        />
                    }
                    <ListComponent
                        ref="list"
                        key={searchView?"search-results":"files-list"}
                        pydio={pydio}
                        dataModel={pydio.getContextHolder()}
                        searchResults={searchView}
                        searchScope={values ? values.scope : null}
                        searchLoading={searchLoading}
                        searchEmpty={empty}
                        onDisplayModeChange={(dMode) => {
                            this.setState({displayMode: dMode});
                        }}
                        onSortingInfoChange={(si) => {
                            const {sortingInfo={}} = this.state;
                            if(sortingInfo.attribute !== si.attribute || sortingInfo.direction !== si.direction) {
                                this.setState({sortingInfo: si})
                            }
                        }}
                        style={styles.listStyle}
                    >
                        {displayMode === 'pages' &&
                            <AppBarRight
                                pydio={pydio}
                                muiTheme={muiTheme}
                                styles={styles}
                                containerStyle={{position:'absolute', top:20, right:10, display:'flex', alignItems:'center', zoom: 0.9}}

                                displayMode={displayMode}
                                headerHeight={headerHeight}
                                sortingInfo={displayMode!=='detail'&&displayMode!=='masonry'?sortingInfo:null}

                                searchIconButton={true}
                                searchIconCallback={() => document.dispatchEvent(new Event('pydioOpenSearch'))}
                                searchTools={searchTools}

                                showChatTab={showChatTab}
                                chatOpen={chatOpen}
                                showInfoPanel={showInfoPanel}
                                infoPanelOpen={infoPanelOpen}
                                onToggleRightPanel={(p) => this.toggleRightPanel(p)}
                                onOpenDrawer={(e)=>this.openDrawer(e)}
                            />
                        }
                    </ListComponent>
                    <MultiColumnPanel
                        {...props}
                        closed={!infoPanelOpen}
                        afterResize={()=>this.resizeAfterTransition()}
                        storageKey={searchView?'FSTemplate.MultiColumn.SearchView':'FSTemplate.MultiColumn.InfoPanel'}
                        dataModel={pydio.getContextHolder()}
                        onRequestClose={()=>{this.toggleRightPanel('info-panel')}}
                        onContentChange={this.infoPanelContentChange.bind(this)}
                        style={styles.infoPanel.masterStyle}
                        mainEmptyStateProps={{
                            iconClassName:'',
                            primaryTextId:'ajax_gui.infopanel.empty.select.file',
                            style:{minHeight: 180, backgroundColor: 'transparent', padding:'0 20px'}
                        }}
                        additionalTemplates={rightAdditionalTemplates}
                        parentWidth={parentWidth}
                    />
                </div>
                {showChatTab && chatOpen && chatDetached && !this.state.kailoMode &&
                    <CellChatDetached
                        pydio={pydio}
                        onRequestClose={()=> this.toggleRightPanel('chat')}
                        onRequestToInfoPanel={() => this.toggleAndStore('chatDetached')}
                    />
                }
                <EditionPanel {...props}/>
                <ModalSearch pydio={pydio} dataModel={modalSearchDM}/>
            </MasterLayout>
        );

    }
}

FSTemplate = withSearch(FSTemplate, 'main', 'ws');
FSTemplate = muiThemeable()(FSTemplate);
FSTemplate.INFO_PANEL_WIDTH = 270

export {FSTemplate as default}
