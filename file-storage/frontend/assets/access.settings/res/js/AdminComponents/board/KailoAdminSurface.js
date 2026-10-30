/*
 * Kailo admin surface of the native console (DD-138(6), design 07 §4.8.5).
 *
 * In Kailo mode the console renders no admin navigation, header, dashboard
 * or any admin function except the one declared surface the page was opened
 * for (window.KailoCells.adminSurface(): key, console node, panel component,
 * READ_ONLY or EDITABLE). Anything else is the Kailo empty state. The surface
 * is not authorization: the native REST policies decide every read and write,
 * and the read-only storage writes are refused by the server.
 */
import React from 'react'

// What the console shows for the context node in Kailo mode:
//   native      not Kailo mode: the upstream console, unchanged
//   unavailable no declared surface for this page, or the node is another panel
//   loading     the surface's own console node is not the context node yet
//   panel       render surface.component for this node, nothing else
export function kailoSurfacePanel(kailo, node) {
    if (!kailo || typeof kailo.kailoMode !== 'function' || !kailo.kailoMode()) {
        return {mode: 'native'};
    }
    const surface = typeof kailo.adminSurface === 'function' ? kailo.adminSurface() : null;
    if (!surface) {
        return {mode: 'unavailable'};
    }
    if (!node || typeof node.getPath !== 'function' || node.getPath() !== surface.node) {
        return {mode: 'loading', surface};
    }
    const component = node.getMetadata && node.getMetadata().get('component');
    if (!component) {
        return {mode: 'loading', surface};
    }
    if (component !== surface.component) {
        return {mode: 'unavailable'};
    }
    return {mode: 'panel', surface};
}

// Props the pinned panel receives on top of its console menu props. A
// READ_ONLY surface has no access to any native write ("accesses" all off:
// no create, edit, delete or re-sync control is rendered).
export function kailoSurfaceProps(surface, menuProps = {}) {
    const props = {kailoSurface: surface};
    if (surface && surface.readOnly) {
        props.kailoReadOnly = true;
        props.accesses = {};
        props.versioningReadonly = true;
    }
    return {...menuProps, ...props};
}

export function KailoSurfaceUnavailable({kailo}) {
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

// The surface page frame: the surface title only when Kailo does not draw
// the page header (top-level visit), then the panel in the content area.
export function KailoSurfaceFrame({kailo, surface, children}) {
    const hosted = !!(kailo && kailo.pageHosted && kailo.pageHosted());
    return (
        <div className="kailo-admin-surface" data-kailo-admin-surface={surface.key}>
            {!hosted && <div className="kailo-admin-surface-title">{surface.title}</div>}
            <div className="kailo-admin-surface-content">{children}</div>
        </div>
    );
}
