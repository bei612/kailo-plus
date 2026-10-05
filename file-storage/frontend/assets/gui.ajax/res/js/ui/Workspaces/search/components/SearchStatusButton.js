import React from 'react'
import {FlatButton} from "material-ui";

export const SearchStatusButton = ({pydio, searchTools, style, buttonStyle, buttonLabelStyle, moreOnly = false}) => {

    const {limit, setLimit, searchLoading, empty, resultsCount} = searchTools;
    let stLabel;

    if(searchLoading) {
        stLabel = pydio.MessageHash['searchengine.searching'];
    } else if(empty) {
        stLabel = pydio.MessageHash['searchengine.start'];
    } else if(resultsCount === 0) {
        stLabel = pydio.MessageHash['478'] // No results found
    } else if(resultsCount < limit) {
        stLabel = pydio.MessageHash['searchengine.results.foundN'].replace('%1', resultsCount)
    } else if(resultsCount >= limit) {
        stLabel = pydio.MessageHash['searchengine.results.withMore'].replace('%1', limit)
        return (
            <FlatButton
                style={buttonStyle}
                labelStyle={buttonLabelStyle}
                label={stLabel}
                onClick={()=>{setLimit(limit+20)}}
            />
        )
    }
    if(moreOnly && !(searchLoading && resultsCount >= limit)) {
        return null
    }
    return (
        <div style={style}>{stLabel}</div>
    )
}