// @title Bento Box Generator
// @description Generates Bento Grid/Box on the current page/artboard
// @author JiriKrblich
// @version 1.0
// @affinity 
// @verified 
// @homepage 
// @github 
// @tags 
// @image images/bento.png

/**
 * name: Bento Box generator
 * description: Generates Bento Grid/Box on the current page/artboard
 * version: 1.0.0
 * author: JiriKrblich
 */

'use strict';
const { Document } = require('/document');
const { Dialog, DialogResult } = require('/dialog');
const { UnitType } = require('/units');
const { Rectangle } = require('/geometry');
const { ShapeRectangle, ShapeCornerType } = require('/shapes');
const { ShapeRectangleApi, ShapeCornerIndex } = require('affinity:geometry');
const { Colour } = require('/colours');
const { FillDescriptor } = require('/fills');
const { AddChildNodesCommandBuilder, DocumentCommand, NodeChildType, NodeMoveType } = require('/commands');
const { ContainerNodeDefinition, ShapeNodeDefinition } = require('/nodes');
const { Selection } = require('/selections');
const { setImmediate } = require('/timers');

let config = {
    blockCount: 8,
    cornerRadius: 30,
    padding: 40,
    gap: 20,
    layoutSeed: 1001,
    colorSeed: 7001,
    paletteMode: 1
};

const PALETTE_MODES = [
    'Grayscale',
    'Random color',
    'Accent color',
    'Soft pastels',
    'High contrast',
    'Brand accents',
    'Muted editorial'
];
const ACCENT_COLORS = [
    { r: 0.16, g: 0.38, b: 0.96 },
    { r: 0.08, g: 0.62, b: 0.52 },
    { r: 0.95, g: 0.34, b: 0.18 },
    { r: 0.58, g: 0.30, b: 0.92 },
    { r: 0.96, g: 0.70, b: 0.18 },
    { r: 0.92, g: 0.18, b: 0.44 }
];
const HIGH_CONTRAST_COLORS = [
    { r: 0.05, g: 0.05, b: 0.06 },
    { r: 0.96, g: 0.96, b: 0.92 },
    { r: 0.02, g: 0.36, b: 0.92 },
    { r: 0.98, g: 0.72, b: 0.08 },
    { r: 0.90, g: 0.10, b: 0.18 }
];
const BRAND_ACCENT_COLORS = [
    { r: 0.05, g: 0.12, b: 0.22 },
    { r: 0.10, g: 0.42, b: 0.92 },
    { r: 0.02, g: 0.64, b: 0.56 },
    { r: 0.95, g: 0.72, b: 0.18 },
    { r: 0.94, g: 0.96, b: 0.98 }
];
const MUTED_EDITORIAL_COLORS = [
    { r: 0.23, g: 0.25, b: 0.27 },
    { r: 0.53, g: 0.56, b: 0.50 },
    { r: 0.72, g: 0.64, b: 0.55 },
    { r: 0.47, g: 0.58, b: 0.62 },
    { r: 0.83, g: 0.78, b: 0.69 },
    { r: 0.90, g: 0.88, b: 0.82 }
];

function createRng(seed) {
    let t = Math.max(1, Math.floor(seed || 1)) >>> 0;
    return function rng() {
        t += 0x6D2B79F5;
        let x = t;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Layout algorithm ──────────────────────────────────────────────────────────
//
// Two-phase guillotine cut with design constraints:
//   Phase 1  — mandatory splits until every rect is within maxSpan
//               (prevents full-width / full-height strips)
//   Phase 2  — area-weighted random splits until targetBlocks reached
//   Retry    — regenerate up to 200×; accept only when pixel AR ∈ [0.25, 4.0]
//               (prevents boxes that are too narrow or too flat for content)
//
// For n < 4 the maxSpan constraint is relaxed — a 3-box bento will always
// contain one large "hero" box, and that is intentional.

function computeParams(n) {
    if (n <= 3) return { gridSize: Math.max(6, n * 2), maxSpan: 999, minCells: 1 };
    const gs = Math.max(n + 4, 12);
    return { gridSize: gs, maxSpan: Math.floor(gs * 0.65), minCells: 2 };
}

function splitRect(r, doH, minCells, maxSpan, rng) {
    if (doH) {
        const lo = Math.max(minCells, r.w - maxSpan);
        const hi = Math.min(r.w - minCells, maxSpan);
        const slo = Math.max(lo, Math.floor(r.w * 0.25));
        const shi = Math.min(hi, Math.floor(r.w * 0.75));
        const flo = slo <= shi ? slo : lo;
        const fhi = slo <= shi ? shi : hi;
        if (flo > fhi) return null;
        const s = flo + Math.floor(rng() * (fhi - flo + 1));
        return [{ col: r.col,     row: r.row, w: s,       h: r.h },
                { col: r.col + s, row: r.row, w: r.w - s, h: r.h }];
    } else {
        const lo = Math.max(minCells, r.h - maxSpan);
        const hi = Math.min(r.h - minCells, maxSpan);
        const slo = Math.max(lo, Math.floor(r.h * 0.25));
        const shi = Math.min(hi, Math.floor(r.h * 0.75));
        const flo = slo <= shi ? slo : lo;
        const fhi = slo <= shi ? shi : hi;
        if (flo > fhi) return null;
        const s = flo + Math.floor(rng() * (fhi - flo + 1));
        return [{ col: r.col, row: r.row,     w: r.w, h: s       },
                { col: r.col, row: r.row + s, w: r.w, h: r.h - s }];
    }
}

function tryGenerate(n, gridSize, maxSpan, minCells, rng) {
    let rects = [{ col: 0, row: 0, w: gridSize, h: gridSize }];

    // Phase 1: mandatory splits — bring all rects within maxSpan
    for (let i = 0; i < 500; i++) {
        const idx = rects.findIndex(r => r.w > maxSpan || r.h > maxSpan);
        if (idx < 0) break;
        const r = rects.splice(idx, 1)[0];
        const overH = r.w > maxSpan, overV = r.h > maxSpan;
        const doH = overH && !overV ? true : !overH && overV ? false : rng() < 0.5;
        const pieces = splitRect(r, doH, minCells, maxSpan, rng)
                    || splitRect(r, !doH, minCells, maxSpan, rng);
        if (!pieces) { rects.push(r); break; }
        rects.push(...pieces);
    }

    // Phase 2: random area-weighted splits until n reached
    while (rects.length < n) {
        const eligible = rects.filter(r => r.w >= 2 * minCells || r.h >= 2 * minCells);
        if (!eligible.length) break;
        const total = eligible.reduce((s, r) => s + r.w * r.h, 0);
        let pick = rng() * total, chosen = eligible[eligible.length - 1];
        for (const r of eligible) { pick -= r.w * r.h; if (pick <= 0) { chosen = r; break; } }
        rects.splice(rects.indexOf(chosen), 1);
        const cH = chosen.w >= 2 * minCells, cV = chosen.h >= 2 * minCells;
        const doH = cH && cV ? rng() < chosen.w / (chosen.w + chosen.h) : cH;
        const pieces = splitRect(chosen, doH, minCells, 9999, rng);
        if (!pieces) { rects.push(chosen); break; }
        rects.push(...pieces);
    }

    return rects.map(r => [r.col, r.row, r.w, r.h]);
}

function generateControlledLayout(n, canvasAspect, seed) {
    const { gridSize, maxSpan, minCells } = computeParams(n);

    for (let attempt = 0; attempt < 200; attempt++) {
        const layout = tryGenerate(n, gridSize, maxSpan, minCells, createRng(seed + attempt * 9973));
        const valid =
            layout.length === n &&
            layout.reduce((s, [,, w, h]) => s + w * h, 0) === gridSize * gridSize &&
            layout.every(([,, w, h]) => w <= maxSpan && h <= maxSpan) &&
            layout.every(([,, w, h]) => {
                const ar = (w * canvasAspect) / h;
                return ar >= 0.25 && ar <= 4.0;
            });
        if (valid) return { layout, gridSize };
    }
    // Fallback: return any valid-coverage layout
    return { layout: tryGenerate(n, gridSize, maxSpan, minCells, createRng(seed + 999983)), gridSize };
}

function clampLayoutSpacing(box, gridSize, requestedPadding, requestedGap) {
    const shortSide = Math.max(1, Math.min(box.width, box.height));
    let padding = Math.max(0, requestedPadding);
    let gap = Math.max(0, requestedGap);
    const minCell = Math.max(4, shortSide * 0.008);

    const maxPadding = Math.max(0, (shortSide - (gridSize - 1) * gap - gridSize * minCell) / 2);
    padding = Math.min(padding, maxPadding);

    const maxGapW = gridSize > 1 ? (box.width - 2 * padding - gridSize * minCell) / (gridSize - 1) : gap;
    const maxGapH = gridSize > 1 ? (box.height - 2 * padding - gridSize * minCell) / (gridSize - 1) : gap;
    gap = Math.min(gap, Math.max(0, maxGapW), Math.max(0, maxGapH));

    return { padding, gap, wasClamped: padding !== requestedPadding || gap !== requestedGap };
}

function colourForBox(index, count, rng) {
    const t = count <= 1 ? 0 : index / (count - 1);

    if (config.paletteMode === 0) {
        const v = 0.82 + t * 0.14 + (rng() - 0.5) * 0.04;
        return FillDescriptor.createSolid(Colour.createRGBAuf({ r: v, g: v, b: v, alpha: 1.0 }));
    }

    if (config.paletteMode === 2) {
        const base = ACCENT_COLORS[index % ACCENT_COLORS.length];
        const mix = 0.82 + rng() * 0.14;
        return FillDescriptor.createSolid(Colour.createRGBAuf({
            r: base.r * mix + (1 - mix),
            g: base.g * mix + (1 - mix),
            b: base.b * mix + (1 - mix),
            alpha: 1.0
        }));
    }

    if (config.paletteMode === 3) {
        return FillDescriptor.createSolid(Colour.createRGBAuf({
            r: 0.68 + rng() * 0.24,
            g: 0.68 + rng() * 0.24,
            b: 0.68 + rng() * 0.24,
            alpha: 1.0
        }));
    }

    if (config.paletteMode === 4) {
        const base = HIGH_CONTRAST_COLORS[index % HIGH_CONTRAST_COLORS.length];
        return FillDescriptor.createSolid(Colour.createRGBAuf({ ...base, alpha: 1.0 }));
    }

    if (config.paletteMode === 5) {
        const base = BRAND_ACCENT_COLORS[index % BRAND_ACCENT_COLORS.length];
        const lift = 0.88 + rng() * 0.10;
        return FillDescriptor.createSolid(Colour.createRGBAuf({
            r: base.r * lift + (1 - lift),
            g: base.g * lift + (1 - lift),
            b: base.b * lift + (1 - lift),
            alpha: 1.0
        }));
    }

    if (config.paletteMode === 6) {
        const base = MUTED_EDITORIAL_COLORS[index % MUTED_EDITORIAL_COLORS.length];
        const variation = (rng() - 0.5) * 0.06;
        return FillDescriptor.createSolid(Colour.createRGBAuf({
            r: Math.max(0, Math.min(1, base.r + variation)),
            g: Math.max(0, Math.min(1, base.g + variation)),
            b: Math.max(0, Math.min(1, base.b + variation)),
            alpha: 1.0
        }));
    }

    return FillDescriptor.createSolid(Colour.createRGBAuf({
        r: 0.18 + rng() * 0.72,
        g: 0.18 + rng() * 0.72,
        b: 0.18 + rng() * 0.72,
        alpha: 1.0
    }));
}

function applyRoundedCorners(shape, width, height, radius) {
    shape.useSingleRadius = true;
    shape.setAbsoluteSizes(true, width, height);

    const cornerRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
    const corners = [
        ShapeCornerIndex.TopLeft,
        ShapeCornerIndex.TopRight,
        ShapeCornerIndex.BottomLeft,
        ShapeCornerIndex.BottomRight
    ];

    for (const corner of corners) {
        ShapeRectangleApi.setCornerType(shape.handle, corner, ShapeCornerType.Round);
        ShapeRectangleApi.setCornerRadius(shape.handle, corner, cornerRadius, width, height);
    }
}

// ── Target detection ──────────────────────────────────────────────────────────

function pushUniqueNode(nodes, node) {
    if (!node || nodes.indexOf(node) >= 0) return;
    nodes.push(node);
}

function selectionNodes(selection) {
    const nodes = [];
    if (!selection) return nodes;

    try {
        for (let i = 0; i < selection.length; i++) {
            const item = selection.at(i);
            pushUniqueNode(nodes, item && item.node ? item.node : item);
        }
    } catch (_) {}

    try {
        const selectedNodes = selection.nodes;
        const arr = selectedNodes && typeof selectedNodes.toArray === 'function'
            ? selectedNodes.toArray()
            : selectedNodes;
        for (const node of arr || []) pushUniqueNode(nodes, node);
    } catch (_) {}

    try {
        pushUniqueNode(nodes, selection.firstNode);
    } catch (_) {}

    return nodes;
}

function findArtboard(node) {
    let current = node;
    while (current && current[Symbol.toStringTag] !== 'SpreadNode') {
        try {
            const abi = current.artboardInterface;
            if (abi && abi.isArtboardEnabled) {
                return {
                    node: current,
                    box: abi.spreadBaseBox || current.getSpreadBaseBox(false) || abi.baseBox
                };
            }
        } catch (_) {}
        current = current.parent;
    }
    return null;
}

function detectTarget() {
    const doc = Document.current;
    const spread = doc.currentSpread;

    for (const node of selectionNodes(doc.selection)) {
        const artboard = findArtboard(node);
        if (artboard && artboard.box) {
            return {
                node: spread,
                box: artboard.box,
                artboardNode: artboard.node
            };
        }
    }

    const box = spread.getSpreadExtents();
    return { node: spread, box };
}

// ── Preview generation ────────────────────────────────────────────────────────

function exec(doc, cmd) {
    return doc.executeCommand(cmd, false);
}

function createGroup(doc, target, name) {
    const builder = AddChildNodesCommandBuilder.create();
    builder.setInsertionTarget(target.node);
    builder.addContainerNode(ContainerNodeDefinition.create(name));
    const cmd = builder.createCommand(false, NodeChildType.Main);
    exec(doc, cmd);
    return cmd.newNodes && cmd.newNodes.length ? cmd.newNodes[0] : null;
}

function moveGroupIntoArtboard(doc, groupNode, artboardNode) {
    if (!groupNode || !artboardNode) return;
    try {
        exec(doc, DocumentCommand.createMoveNodes(
            Selection.create(doc, [groupNode], true),
            artboardNode,
            NodeMoveType.Inside,
            NodeChildType.Main
        ));
    } catch (e) {
        console.log('Bento Box artboard move failed: ' + (e && e.message ? e.message : e));
    }
}

function deleteGroup(doc, groupNode) {
    if (!groupNode) return;
    try {
        exec(doc, DocumentCommand.createDeleteSelection(
            Selection.create(doc, [groupNode], true)
        ));
    } catch (_) {}
}

function selectNode(doc, node) {
    if (!node) return;
    try {
        exec(doc, DocumentCommand.createSetSelection(
            Selection.create(doc, [node], true)
        ));
    } catch (_) {}
}

function renameNode(doc, node, name) {
    if (!node) return;
    try {
        exec(doc, DocumentCommand.createSetDescription(
            Selection.create(doc, [node], true), name
        ));
    } catch (_) {}
}

function createBentoBoxes(doc, target, name) {
    const group = createGroup(doc, target, name);
    if (!group) throw new Error('Could not create Bento Box preview group.');

    const { box } = target;
    const canvasAspect = box.width / box.height;
    const { layout, gridSize } = generateControlledLayout(config.blockCount, canvasAspect, config.layoutSeed);
    const spacing = clampLayoutSpacing(box, gridSize, config.padding, config.gap);
    const rng = createRng(config.colorSeed + 424242);

    const cellW = (box.width  - 2 * spacing.padding - (gridSize - 1) * spacing.gap) / gridSize;
    const cellH = (box.height - 2 * spacing.padding - (gridSize - 1) * spacing.gap) / gridSize;

    const builder = AddChildNodesCommandBuilder.create();
    builder.setInsertionTarget(group);

    layout.forEach(([c, r, w, h], i) => {
        const x = box.x + spacing.padding + c * (cellW + spacing.gap);
        const y = box.y + spacing.padding + r * (cellH + spacing.gap);
        const W = w * cellW + (w - 1) * spacing.gap;
        const H = h * cellH + (h - 1) * spacing.gap;

        const shape = ShapeRectangle.create();
        applyRoundedCorners(shape, W, H, config.cornerRadius);

        builder.addShapeNode(ShapeNodeDefinition.create(
            shape, new Rectangle(x, y, W, H), colourForBox(i, layout.length, rng)
        ));
    });

    exec(doc, builder.createCommand(false, NodeChildType.Main));
    moveGroupIntoArtboard(doc, group, target.artboardNode);

    return { group, boxes: layout.length, gridSize, spacing };
}

// ── Dialog ────────────────────────────────────────────────────────────────────

function showDialog(savedTarget) {
    const doc = Document.current;
    if (!doc) return;

    const target = savedTarget || detectTarget();

    const dialog = Dialog.create('Bento Box Generator');
    dialog.initialWidth = 360;
    dialog.isResizable = true;
    const col = dialog.addColumn();

    const grp = col.addGroup('Settings');

    const blockCtrl = grp.addUnitValueEditor('Block count', UnitType.None, UnitType.None, config.blockCount, 3, 16);
    blockCtrl.showPopupSlider = true;
    blockCtrl.precision = 0;

    const radiusCtrl = grp.addUnitValueEditor('Corner radius', UnitType.Pixel, UnitType.Pixel, config.cornerRadius, 0, 200);
    radiusCtrl.showPopupSlider = true;
    radiusCtrl.precision = 0;

    const paddingCtrl = grp.addUnitValueEditor('Padding', UnitType.Pixel, UnitType.Pixel, config.padding, 0, 200);
    paddingCtrl.showPopupSlider = true;
    paddingCtrl.precision = 0;

    const gapCtrl = grp.addUnitValueEditor('Gap', UnitType.Pixel, UnitType.Pixel, config.gap, 0, 100);
    gapCtrl.showPopupSlider = true;
    gapCtrl.precision = 0;

    const paletteCtrl = grp.addComboBox('Palette', PALETTE_MODES, config.paletteMode);

    const regenGrp = col.addGroup('Layout');
    const randomiseCtrl = regenGrp.addButtonSet('', ['Randomise layout', 'Randomise again'], 0);
    randomiseCtrl.isFullWidth = true;

    const actionGrp = col.addGroup('');
    const statusTxt = actionGrp.addStaticText('', 'Preview updates live. OK keeps the result; Cancel removes it.');
    statusTxt.isFullWidth = true;

    function readConfig() {
        config.blockCount   = Math.round(blockCtrl.value);
        config.cornerRadius = radiusCtrl.value;
        config.padding      = paddingCtrl.value;
        config.gap          = gapCtrl.value;
        config.paletteMode  = paletteCtrl.selectedIndex;
    }

    let previewGroup = null;

    function clearPreviewGroup() {
        if (previewGroup) {
            deleteGroup(doc, previewGroup);
            previewGroup = null;
        }
    }

    function showPreview(initial) {
        try {
            readConfig();
            clearPreviewGroup();
            const res = createBentoBoxes(doc, target, 'Bento Box Preview');
            previewGroup = res.group;
            const clampNote = res.spacing.wasClamped ? ' spacing clamped' : '';
            statusTxt.text = `${initial ? 'Preview' : 'Preview'}: ${res.boxes} boxes on ${res.gridSize}×${res.gridSize} grid.${clampNote}`;
        } catch (e) {
            statusTxt.text = 'Preview error: ' + (e && e.message ? e.message : e);
            console.log('Bento Box preview error: ' + (e && e.stack ? e.stack : e));
        }
    }

    let isUpdatingPreview = false;
    function updatePreview() {
        if (isUpdatingPreview) return;
        isUpdatingPreview = true;
        try {
            showPreview(false);
        } finally {
            isUpdatingPreview = false;
        }
    }

    randomiseCtrl.onValueChangedHandler = function () {
        config.layoutSeed = Math.max(1, config.layoutSeed + 1);
        updatePreview();
    };

    for (const ctrl of [blockCtrl, radiusCtrl, paddingCtrl, gapCtrl, paletteCtrl]) {
        ctrl.onValueChangedHandler = updatePreview;
    }

    statusTxt.text = 'Opening preview...';
    setImmediate(() => showPreview(true));

    const result = dialog.runModal();

    if (result.value === DialogResult.Ok.value) {
        try {
            readConfig();
            if (!previewGroup) {
                const res = createBentoBoxes(doc, target, 'Bento Box Preview');
                previewGroup = res.group;
            }
            renameNode(doc, previewGroup, 'Bento Box');
            selectNode(doc, previewGroup);
        } catch (e) {
            const err = Dialog.create('Bento Box Generator - Apply error');
            const g = err.addColumn().addGroup('');
            const s = g.addStaticText('', String(e && e.stack ? e.stack : e));
            s.isFullWidth = true;
            err.runModal();
        }
    } else {
        clearPreviewGroup();
    }
}

showDialog();
