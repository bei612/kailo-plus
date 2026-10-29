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

const {
    Component
} = require('react')
const {FlatButton, FontIcon} = require('material-ui')
const {muiThemeable} = require('material-ui/styles')
const Color = require('color')
const PropTypes = require('prop-types');
const Pydio = require('pydio')
const {PydioContextConsumer} = Pydio.requireLib('boot')

class EmptyStateView extends Component{

    constructor(props, context){
        super(props, context);
    }

    render(){
        const {style, iconClassName, primaryTextId, secondaryTextId, actionLabelId, actionCallback,
            actionStyle, actionIconClassName, getMessage, iconStyle, legendStyle, buttonContainerStyle, muiTheme} = this.props;

        const mainColor = Color(muiTheme.palette.mui3.outline||'#aaa');

        const styles = {
            container: {
                display:'flex',
                alignItems:'center',
                justifyContent:'center',
                height: '100%',
                width: '100%',
                flex:1,
                backgroundColor:mainColor.lightness(97).rgb().toString(),
                ...style
            },
            centered : {
                maxWidth: 280,
                textAlign:'center',
                color: mainColor.toString()
            },
            icon : {
                fontSize: 100,
                ...iconStyle,
            },
            primaryText : {
                fontSize: 16,
                fontWeight: 500,
                ...legendStyle
            },
            secondaryText : {
                marginTop: 20,
                fontSize: 13
            },
            buttonContainer: {
                marginTop: 100,
                textAlign: 'center',
                ...buttonContainerStyle
            },
            buttonStyle: {
                color: muiTheme.palette.mui3.primary
            }
        };
        // DD-157 (20 §13.6 空态): Kailo empty state — no tinted (white in dark) box,
        // a 64px brand line icon, title 17/24 600, description 14 muted, one action.
        const kailo = typeof window !== 'undefined' && window.KailoCells && window.KailoCells.kailoMode && window.KailoCells.kailoMode()
        if (kailo) {
            styles.container = {...styles.container, backgroundColor: 'transparent'}
            styles.centered = {...styles.centered, maxWidth: 320, color: 'var(--kailo-color-muted-foreground)'}
            styles.icon = {...styles.icon, fontSize: 64, lineHeight: '64px', color: 'var(--kailo-color-brand)', marginBottom: 16}
            styles.primaryText = {...styles.primaryText, fontSize: 17, lineHeight: '24px', fontWeight: 600, color: 'var(--kailo-color-foreground)'}
            styles.secondaryText = {...styles.secondaryText, marginTop: 4, fontSize: 14, lineHeight: '20px', color: 'var(--kailo-color-muted-foreground)'}
            styles.buttonContainer = {...styles.buttonContainer, marginTop: 16}
        }
        const buttonIcon = actionIconClassName ? <FontIcon className={actionIconClassName}/> : null;
        return (
            <div style={styles.container} className={"kailo-empty-state"}>
                <div style={styles.centered}>
                    <div className={iconClassName} style={styles.icon}/>
                    <div style={styles.primaryText}>{getMessage(primaryTextId)}</div>
                    {secondaryTextId &&
                        <div style={styles.secondaryText}>{getMessage(secondaryTextId)}</div>
                    }
                    {actionLabelId && actionCallback &&
                        <div style={{...styles.buttonContainer, ...actionStyle}}>
                            <FlatButton style={styles.buttonStyle} label={getMessage(actionLabelId)} onClick={actionCallback} icon={buttonIcon}/>
                        </div>
                    }
                </div>
            </div>
        );

    }

}

EmptyStateView.propTypes = {

    pydio: PropTypes.instanceOf(Pydio).isRequired,
    iconClassName: PropTypes.string.isRequired,
    primaryTextId: PropTypes.string.isRequired,

    secondaryTextId: PropTypes.string,
    actionLabelId: PropTypes.string,
    actionCallback: PropTypes.func,
    actionStyle: PropTypes.object,

    style: PropTypes.object,
    iconStyle: PropTypes.object,
    legendStyle: PropTypes.object,
    getMessage: PropTypes.func

};

EmptyStateView = PydioContextConsumer(EmptyStateView);
EmptyStateView = muiThemeable()(EmptyStateView);

export {EmptyStateView as default}