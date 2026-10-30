/*
 * Kailo admin surface route (DD-138(6), design 07 §4.8.5).
 *
 * The server serves /kailo-admin/<surface> only for a declared surface whose
 * launch carries its own kailo_admin_surface key (frontend/web/kailo-admin.go).
 * This route opens the native console workspace pinned to that one admin
 * function; the console's AdminDashboard then renders only that panel
 * (no admin navigation, header or other admin function). Everything else on
 * this path is a Kailo empty state: an unknown key, a person without the
 * native admin rights the member directory derives, or no Kailo mode.
 * Until the panel can render, a plain canvas covers the page so the business
 * page never shows here. The key is not authorization: the native REST
 * policies decide every read and write.
 */
import React from 'react'

const SETTINGS = 'settings';

export function kailoAdminRouteState(pydio, kailo) {
    const surface = kailo && kailo.adminSurface ? kailo.adminSurface() : null;
    if (!surface) {
        return 'unavailable';
    }
    const user = pydio && pydio.user;
    if (!user) {
        // Silent Kailo sign-in in progress (native "login" action).
        return 'cover';
    }
    if (user.getActiveRepository() === SETTINGS) {
        return 'console';
    }
    return user.getRepositoriesList().has(SETTINGS) ? 'switch' : 'unavailable';
}

export function KailoAdminUnavailable({kailo}) {
    const text = (key) => (kailo && kailo.text ? kailo.text(key) : key);
    React.useEffect(() => {
        if (kailo && kailo.setAdminSurfaceState) {
            kailo.setAdminSurfaceState({ready: true});
        }
    }, [kailo]);
    return (
        <div className="kailo-admin-cover">
            <div className="kailo-admin-empty" role="status">
                <div className="kailo-admin-empty-icon" aria-hidden="true"/>
                <div className="kailo-admin-empty-title">{text('adminUnavailable')}</div>
                <div className="kailo-admin-empty-body">{text('adminUnavailableBody')}</div>
            </div>
        </div>
    );
}

const KailoAdminRouterWrapper = (pydio) => {

    class KailoAdminRouter extends React.PureComponent {

        constructor(props) {
            super(props);
            this.state = {tick: 0};
            this._refresh = () => this.setState(({tick}) => ({tick: tick + 1}), () => this.sync());
        }

        componentDidMount() {
            ['user_logged', 'repository_list_refreshed', 'registry_loaded'].forEach((e) => pydio.observe(e, this._refresh));
            this.sync();
        }

        componentWillUnmount() {
            ['user_logged', 'repository_list_refreshed', 'registry_loaded'].forEach((e) => pydio.stopObserving(e, this._refresh));
        }

        sync() {
            const kailo = window.KailoCells;
            if (kailoAdminRouteState(pydio, kailo) !== 'switch' || this._switching || this._attempted) {
                return;
            }
            // Open the console workspace on the surface's own panel (once).
            this._switching = true;
            this._attempted = true;
            pydio._initLoadRep = kailo.adminSurface().node;
            const done = () => {
                this._switching = false;
                this._refresh();
            };
            Promise.resolve(pydio.triggerRepositoryChange(SETTINGS)).then(done, done);
        }

        render() {
            const kailo = window.KailoCells;
            let state = kailoAdminRouteState(pydio, kailo);
            if (state === 'switch' && this._attempted && !this._switching) {
                // The server did not open the console workspace for this person.
                state = 'unavailable';
            }
            switch (state) {
                case 'console':
                    return null;
                case 'unavailable':
                    return <KailoAdminUnavailable kailo={kailo}/>;
                default:
                    return <div className="kailo-admin-cover"/>;
            }
        }
    }

    return KailoAdminRouter;
};

export default KailoAdminRouterWrapper
