// CustomDragLayer.js
import React, { useState, useEffect, useRef } from 'react';
import { DragLayer } from 'react-dnd';

function collect(monitor) {
    return {
        isDragging:    monitor.isDragging(),
        didDrop:       monitor.didDrop(),
        item:          monitor.getItem(),
        clientOffset:  monitor.getClientOffset(),                  // mouse x/y
        initialClientOffset: monitor.getInitialClientOffset(),
    };
}

function CustomDragLayer({pydio, isDragging, didDrop, item, clientOffset, initialClientOffset}) {
    const [isAnimating, setIsAnimating] = useState(false);
    const [shouldTransition, setShouldTransition] = useState(false);
    const [altKeyPressed, setAltKeyPressed] = useState(false);
    const prevIsDragging = useRef(false);
    const dragData = useRef({});

    useEffect(() => {
        if (isDragging && item && clientOffset && initialClientOffset) {
            // Reset any previous animation state when starting a new drag
            if (!prevIsDragging.current) {
                setIsAnimating(false);
                setShouldTransition(false);
            }

            // Store drag data while dragging
            dragData.current = {
                item: item,
                clientOffset: { ...clientOffset },
                initialClientOffset: { ...initialClientOffset }
            };
            prevIsDragging.current = true;
        } else if (prevIsDragging.current && !isDragging && dragData.current.item) {
            // Drag just ended
            const dropSuccessful = dragData.current.item._dropSuccessful;

            if (dropSuccessful !== true) {
                // Only animate back if the drop was unsuccessful or undefined
                setIsAnimating(true);
                prevIsDragging.current = false;

                // Use requestAnimationFrame to ensure smooth transition
                requestAnimationFrame(() => {
                    setShouldTransition(true);
                });

                setTimeout(() => {
                    setIsAnimating(false);
                    setShouldTransition(false);
                    dragData.current = {};
                }, 300);
            } else {
                // Successful drop - just clean up immediately
                prevIsDragging.current = false;
                dragData.current = {};
            }
        }
    }, [isDragging, item, clientOffset, initialClientOffset]);

    // Monitor Alt key during drag
    useEffect(() => {
        if (!isDragging) {
            setAltKeyPressed(false);
            return;
        }

        const handleMouseMove = (e) => {
            const isAltPressed = e.altKey;
            if (isAltPressed !== altKeyPressed) {
                setAltKeyPressed(isAltPressed);
            }
        };

        // Also try dragover events
        const handleDragOver = (e) => {
            const isAltPressed = e.altKey;
            if (isAltPressed !== altKeyPressed) {
                setAltKeyPressed(isAltPressed);
            }
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('dragover', handleDragOver);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('dragover', handleDragOver);
        };
    }, [isDragging, altKeyPressed]);

    if (!isDragging && !isAnimating) {
        return null;
    }

    // Use current values during drag, stored values during animation
    const currentItem = isDragging ? item : dragData.current.item;
    const currentClientOffset = isDragging ? clientOffset : dragData.current.clientOffset;
    const currentInitialOffset = isDragging ? initialClientOffset : dragData.current.initialClientOffset;

    if (!currentItem || !currentItem.node || !currentClientOffset) {
        return null;
    }

    let selection = pydio.getContextHolder().getSelectedNodes();
    if(selection.length <= 1) {
        selection = [currentItem.node]
    }


    // For animation, we need both current and initial positions
    const animateToX = currentInitialOffset ? currentInitialOffset.x : currentClientOffset.x;
    const animateToY = currentInitialOffset ? currentInitialOffset.y : currentClientOffset.y;

    const style = {
        position:      'fixed',
        pointerEvents: 'none',
        top:           isAnimating && shouldTransition ? animateToY : currentClientOffset.y,
        left:          isAnimating && shouldTransition ? animateToX : currentClientOffset.x,
        transform:     'translate(-2%, -2%)',
        zIndex:        9999,
        minWidth: 120,
        maxWidth: 320,
        background: 'var(--md-sys-color-surface-1)',
        color: 'var(--md-sys-color-on-surface)',
        borderRadius: 'var(--md-sys-color-card-border-radius)',
        border: '1px dashed var(--md-sys-color-outline)',
        overflow:'hidden',
        padding: '8px 12px',
        opacity: 0.93,
        transition: shouldTransition ? 'all 0.3s ease-out' : 'none',
        fontSize:14
    };

    let more;
    const mm = pydio.MessageHash
    const total = selection.length
    if(selection.length > 10){
        const moreNumbers = selection.length - 10
        selection = selection.slice(0, 10);
        const ms = mm['ajax_gui.drag-layer.more'] || '%s'
        more = <div style={{fontWeight:'500', overflow:'hidden', paddingTop:4, textAlign:'right'}}>{ms.replace('%s', moreNumbers)}</div>
    }

    let title;
    let key = 'ajax_gui.drag-layer.';
    if(altKeyPressed){
        key+='copy.'
    } else {
        key+='move.'
    }
    if(total>1) {
        key+='plural'
    } else {
        key+=selection[0].isLeaf()?'file':'folder'
    }
    title = (mm[key]||'%s').replace('%s', total+'');
    return (
        <div style={style}>
            <div style={{fontWeight:'500', overflow:'hidden', paddingBottom:4, display: 'flex', alignItems: 'baseline'}}>
                <div style={{flex: 1}}>{title}</div>
                <span style={{fontSize: '0.8em', opacity:altKeyPressed?0:0.33, paddingLeft:10}}>{mm['ajax_gui.drag-layer.hint']}</span>
            </div>
            {selection.map((node) => {
                return (
                    <div style={{display:'flex', width:'100%', padding: '2px 4px 2px 0'}}>
                        <div className={'mimefont mdi mdi-' + (node.isLeaf()?'file':'folder')} style={{paddingRight:4, width: 20, height: 20, fontSize: 16, color:'var(--md-sys-color-mimefont-color)'}}/>
                        <div style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{node.getLabel()}</div>
                    </div>
                )
            })}
            {more}
        </div>
    );
}

export default DragLayer(collect)(CustomDragLayer);