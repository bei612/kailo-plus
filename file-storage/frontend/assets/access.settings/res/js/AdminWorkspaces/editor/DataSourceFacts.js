/*
 * Read-only detail of one data source on the Kailo storage.dataSources admin
 * surface (DD-138(6), design 07 §4.8.5 READ_ONLY, 20 §13.2): a definition
 * list, never a form or a disabled input. The facts come from
 * KailoCells.dataSourceFacts, which reads no credential.
 */
import React from 'react'

export default function DataSourceFacts({dataSource, policies, closeEditor}) {
    const kailo = window.KailoCells;
    const facts = kailo && kailo.dataSourceFacts ? kailo.dataSourceFacts(dataSource, policies) : [];
    const close = kailo && kailo.text ? kailo.text('close') : 'Close';
    return (
        <div className="kailo-admin-detail-pane">
            <div className="kailo-admin-detail-head">
                <div className="kailo-admin-detail-title">{dataSource && dataSource.Name}</div>
                <button type="button" className="kailo-admin-detail-close" aria-label={close} title={close} onClick={() => closeEditor && closeEditor()}/>
            </div>
            <dl className="kailo-admin-facts">
                {facts.map((fact) => (
                    <div className="kailo-admin-fact" key={fact.label}>
                        <dt>{fact.label}</dt>
                        <dd>{fact.value}</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}
