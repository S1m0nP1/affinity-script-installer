'use strict';
// @id swapobjects
// @title SwapObjects
// @description Swaps the position and rotation of two selected objects or groups while keeping their size unchanged.
// @author BlackMortimer-13
// @version 2.1
// @affinity 3.2+
// @verified false
// @homepage 
// @github 
// @tags object, layout
// @image images/SwapObjects.png
// SwapObjects v2.1
// Fix: single undo step — transforms originals directly (no duplicate/delete).
// A compound command with only createTransform calls = one Ctrl+Z.

const { app } = require('/application');
const { DocumentCommand, CompoundCommandBuilder } = require('/commands');
const { Transform } = require('/geometry');

const APP_NAME = 'SwapObjects';

function getCurrentDocument() {
    try {
        if (app && app.documents) {
            if (app.documents.current) return app.documents.current;
            if (app.documents.all) {
                for (const d of app.documents.all) return d;
            }
        }
    } catch (e) {}
    try {
        const { Document } = require('/document');
        return Document.current || null;
    } catch (e) { return null; }
}

function showMessage(title, message) {
    try {
        const { Dialog } = require('/dialog');
        const dlg = Dialog.create(title);
        dlg.addColumn().addGroup('').addStaticText('', message).isFullWidth = true;
        dlg.show();
    } catch (e) { console.log(title + ': ' + message); }
}

function isSameNode(a, b) {
    if (!a || !b) return false;
    try { return a.isSameNode(b); } catch (e) { return a === b; }
}

function addUnique(nodes, node) {
    if (!node) return;
    if (!nodes.some(n => isSameNode(n, node))) nodes.push(node);
}

function getSelectionNodes(doc) {
    const nodes = [];
    const sel = doc && doc.selection;
    if (!sel) return nodes;
    try {
        if (sel.nodes) { for (const n of sel.nodes) addUnique(nodes, n); return nodes; }
    } catch (e) {}
    try {
        const len = sel.length || 0;
        for (let i = 0; i < len; i++) {
            const item = sel.at(i);
            addUnique(nodes, item && item.node ? item.node : item);
        }
    } catch (e) {}
    return nodes;
}

function getTopLevelNodes(nodes) {
    return nodes.filter(n => {
        let p = n.parent;
        while (p) {
            if (nodes.some(s => isSameNode(s, p))) return false;
            p = p.parent;
        }
        return true;
    });
}

function isFiniteBox(box) {
    return !!box &&
        Number.isFinite(box.x) && Number.isFinite(box.y) &&
        Number.isFinite(box.width) && Number.isFinite(box.height);
}

function getSpreadBox(node) {
    try { const b = node.exactSpreadBaseBox; if (isFiniteBox(b)) return b; } catch (e) {}
    try { const b = node.getSpreadBaseBox(false); if (isFiniteBox(b)) return b; } catch (e) {}
    throw new Error('Cannot read object bounds.');
}

function nodeTag(node) {
    try { return node && node[Symbol.toStringTag] ? String(node[Symbol.toStringTag]) : ''; } catch (e) { return ''; }
}

function getWorldTransform(node) {
    try {
        const localToSpread = node.localToSpreadTransform;
        const own = node.transformInterface && node.transformInterface.transform;
        if (localToSpread && own && typeof localToSpread.multiply === 'function')
            return localToSpread.multiply(own);
    } catch (e) {}
    try { if (node.baseToSpreadTransform) return node.baseToSpreadTransform; } catch (e) {}
    try { return node.transformInterface && node.transformInterface.transform; } catch (e) { return null; }
}

function decomposeWorld(node) {
    try {
        const t = getWorldTransform(node);
        if (t && typeof t.decompose === 'function') return t.decompose();
    } catch (e) {}
    return { rotation: 0 };
}

function firstChildForVisuals(node) {
    if (nodeTag(node) !== 'GroupNode') return node;
    try { for (const child of node.children) return child; } catch (e) {}
    return node;
}

function getVisualRotation(node) {
    return decomposeWorld(firstChildForVisuals(node)).rotation || 0;
}

// Returns a transform that: first translates (dx, dy), then rotates delta degrees about (cx, cy).
// Applied to a node whose current center is src.cx/cy, this moves it to dst.cx/cy with dst.rot.
function makeSwapTransform(dx, dy, cx, cy, delta) {
    const translate = Transform.createTranslate(dx, dy);
    if (Math.abs(delta) <= 0.001) return translate;

    // rotateAbout(cx, cy, delta) * translate(dx, dy)
    const rotateAbout = Transform.createTranslate(cx, cy)
        .multiply(Transform.createRotate(delta))
        .multiply(Transform.createTranslate(-cx, -cy));

    return rotateAbout.multiply(translate);
}

function main() {
    const doc = getCurrentDocument();
    if (!doc) { showMessage(APP_NAME, 'No document open.'); return; }

    const topLevel = getTopLevelNodes(getSelectionNodes(doc));
    if (topLevel.length !== 2) {
        showMessage(APP_NAME, 'Select exactly 2 objects or groups.');
        return;
    }

    // Snapshot bounds + rotation BEFORE any changes
    const snap = topLevel.map(n => {
        const bb = getSpreadBox(n);
        return {
            node: n,
            cx: bb.x + bb.width / 2,
            cy: bb.y + bb.height / 2,
            rot: getVisualRotation(n)
        };
    });

    const cb = CompoundCommandBuilder.create();

    // A -> B position+rotation, B -> A position+rotation
    // Both use original (pre-swap) snap data — compound executes atomically.
    for (let i = 0; i < 2; i++) {
        const j = 1 - i;
        const src = snap[i];
        const dst = snap[j];

        const tf = makeSwapTransform(
            dst.cx - src.cx,   // dx
            dst.cy - src.cy,   // dy
            dst.cx, dst.cy,    // rotate about destination center
            dst.rot - src.rot  // delta rotation
        );

        cb.addCommand(DocumentCommand.createTransform(src.node.selfSelection, tf));
    }

    doc.executeCommand(cb.createCommand());
    console.log('SwapObjects v2.1: done (single undo step).');
}

module.exports.main = main;
main();
