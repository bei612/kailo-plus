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
import createReactClass from 'create-react-class';
import {muiThemeable} from 'material-ui/styles'
import {Card, CardTitle, CardMedia, CardActions, CardText, FlatButton, List, ListItem, Divider, IconButton, FontIcon} from 'material-ui'
import {MessagesConsumerMixin} from '../util/Mixins'
import shuffle from 'lodash.shuffle'
import Header from '../styles/Header'
import AdminStyles from "../styles/AdminStyles";
import DOMUtils from 'pydio/util/dom'

let Dashboard = createReactClass({
    displayName: 'Dashboard',
    mixins: [MessagesConsumerMixin],

    getInitialState: function(){
        return {kb: []};
    },

    componentDidMount: function(){
        PydioApi.getClient().loadFile('plug/access.settings/res/i18n/kb.json', (transport) => {
            const data = transport.responseJSON;
            this.setState({kb: data});
        });
    },

    getOpenIcon: function(link){
        return (
            <IconButton
                iconClassName="mdi mdi-arrow-right"
                iconStyle={{color:'rgba(0,0,0,.33)'}}
                tooltip="Open in new window"
                tooltipPosition="bottom-left"
                onClick={() => {window.open(link)}}
            />
        );
    },

    getDocButton: function(icon, message, link, props = {}, icProps = {}){
        return <FlatButton
            key={message}
            label={message}
            primary={true}
            icon={<FontIcon className={"mdi mdi-" + icon} {...icProps}/>}
            onClick={()=>{window.open(link)}}
            {...props}
        />
    },

    welcomeClick: function(e){
        if(e.target.getAttribute('data-path')){
            let p = e.target.getAttribute('data-path');
            if(p === '/plugins/manager'){
                p = '/parameters/manager';
            }
            this.props.pydio.goTo(p);
        }
    },

    render: function(){

        const verticalFlex = {display:'flex', flexDirection:'column', height: '100%'};
        const flexFill = {flex:1};
        const flexContainerStyle = {...verticalFlex};
        const {accent2Color} = this.props.muiTheme.palette;
        const adminStyles= AdminStyles(this.props.muiTheme.palette);
        const w = DOMUtils.getViewportWidth();
        const paperStyle = {...adminStyles.body.block.container, flex: 1, minWidth: Math.min(w - 26, 450), margin: 8};
        const flatStyle = {style: {height: 34,lineHeight: '34px', margin: 2}};
        const flatProps = {...adminStyles.props.header.flatButton, ...flatStyle};
        const icProps = {
            color: adminStyles.props.header.flatButton.labelStyle.color,
            style: {fontSize:20}
        };


        const {pydio} = this.props;
        const message = (id) => {return pydio.MessageHash['admin_dashboard.' + id]};

        // Kailo (DD-133 §1): no upstream guides, community, enterprise or
        // website links; the dashboard keeps its own administration content.
        const guidesButtons = [];

        // DOCS LIST
        let kbItems = [];
        shuffle(this.state.kb).forEach((object) => {
            kbItems.push(<ListItem key={object.title} primaryText={object.title} secondaryText={object.desc} rightIconButton={this.getOpenIcon(object.link)} secondaryTextLines={2} disabled={true}/>);
            kbItems.push(<Divider key={object.title + '-divider'}/>);
        });
        // Remove last divider
        if(kbItems.length) {
            kbItems.pop();
        }

        const WELCOME_COMMUNITY_CARD = (
            <Card zDepth={0} style={{...paperStyle, minWidth:'95%'}}  containerStyle={flexContainerStyle}>
                <div style={adminStyles.body.block.headerFull}>{message('welc.subtitle')}</div>
                <CardText style={flexFill}>
                    <style dangerouslySetInnerHTML={{__html:'.doc-link{color: '+accent2Color+';cursor: pointer;text-decoration:underline;}'}}/>
                    <div style={{lineHeight:'1.6em'}}>
                        <span dangerouslySetInnerHTML={{__html:message('welc.intro')}} onClick={this.welcomeClick}></span>
                        <span dangerouslySetInnerHTML={{__html:message('welc.import')}} onClick={this.welcomeClick}></span>
                    </div>
                </CardText>
            </Card>
        );

        return (
            <div className={"main-layout-nav-to-stack vertical-layout"}>
                <Header
                    title={message('welc.title.5')}
                    icon="mdi mdi-view-dashboard"
                />
                <div className={"layout-fill"} style={{display:'flex', alignItems:'top', flexWrap:'wrap', padding: 5}}>
                    {WELCOME_COMMUNITY_CARD}
                </div>
            </div>
        )
    },
});

Dashboard = muiThemeable()(Dashboard);
export {Dashboard as default}