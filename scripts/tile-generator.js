// @title Tile Generator
// @description Generates tile-based patterns from the selected object with live dialog preview. Supports grid, brick, half-drop, diamond, hexagonal, radial burst, spiral, wave, pinwheel, and random scatter layouts. The generated pattern is fitted back inside the current artboard/page boundaries.
// @author S1m0nP1
// @version 1.1.5
// @affinity 3.2+
// @verified true
// @homepage https://affinityhub.js.org/
// @github https://github.com/S1m0nP1/affinity-script-installer
// @tags pattern, tiles, layout
// @image images/tile.png
// @updated 2026-05-19
// @changelog Add single-command live preview, optional colour shift preview, improved pinwheel layout, and fitted page/artboard output.

"use strict";

const { Document } = require("/document");
const { Dialog, DialogResult } = require("/dialog");
const {
  AddChildNodesCommandBuilder,
  CompoundCommandBuilder,
  DocumentCommand,
  NodeChildType,
  NodeMoveType
} = require("/commands");
const { ContainerNodeDefinition } = require("/nodes");
const { Selection } = require("/selections");
const { Transform } = require("/geometry");
const { UnitType } = require("/units");
const { Colour } = require("/colours");
const { SolidFill, FillDescriptor } = require("/fills");
const { setImmediate } = require("/timers");

const PATTERN_NAMES = [
  "Basic Grid",
  "Brick Offset",
  "Half-Drop",
  "Diamond",
  "Hexagonal",
  "Radial Burst",
  "Spiral",
  "Wave",
  "Pinwheel",
  "Random Scatter"
];

const CONTROL_VALUE_MAX = Number.MAX_SAFE_INTEGER;
const DEFAULT_RANDOM_SEED = 42;

function exec(doc, cmd, preview) {
  return doc.executeCommand(cmd, !!preview);
}

function validNumber(v) {
  return typeof v === "number" && isFinite(v);
}

function rectToPlain(r) {
  if (!r) return null;
  if (validNumber(r.x) && validNumber(r.y) && validNumber(r.width) && validNumber(r.height)) {
    return { x: r.x, y: r.y, width: Math.max(0, r.width), height: Math.max(0, r.height) };
  }
  if (validNumber(r.left) && validNumber(r.top) && validNumber(r.right) && validNumber(r.bottom)) {
    return {
      x: r.left,
      y: r.top,
      width: Math.max(0, r.right - r.left),
      height: Math.max(0, r.bottom - r.top)
    };
  }
  return null;
}

function rectRight(r) { return r.x + r.width; }
function rectBottom(r) { return r.y + r.height; }
function rectCenter(r) { return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }

function containsPoint(r, x, y) {
  return r && x >= r.x && x <= rectRight(r) && y >= r.y && y <= rectBottom(r);
}

function addPointToBounds(b, x, y) {
  if (!validNumber(x) || !validNumber(y)) return b;
  if (!b) return { left: x, top: y, right: x, bottom: y };
  b.left = Math.min(b.left, x);
  b.top = Math.min(b.top, y);
  b.right = Math.max(b.right, x);
  b.bottom = Math.max(b.bottom, y);
  return b;
}

function addRectToBounds(b, r) {
  if (!r) return b;
  b = addPointToBounds(b, r.x, r.y);
  b = addPointToBounds(b, rectRight(r), rectBottom(r));
  return b;
}

function boundsToRect(b) {
  if (!b) return null;
  return {
    x: b.left,
    y: b.top,
    width: Math.max(0, b.right - b.left),
    height: Math.max(0, b.bottom - b.top)
  };
}

function getNodeBox(n) {
  try {
    if (typeof n.getSpreadBaseBox === "function") {
      const b = rectToPlain(n.getSpreadBaseBox(true));
      if (b) return b;
    }
  } catch (e) {}
  try {
    const b = rectToPlain(n.exactSpreadBaseBox);
    if (b) return b;
  } catch (e) {}
  try {
    const b = rectToPlain(n.spreadVisibleBox);
    if (b) return b;
  } catch (e) {}
  return null;
}

function getSelectionBounds(sel) {
  let b = null;
  for (let i = 0; i < sel.length; i++) {
    b = addRectToBounds(b, getNodeBox(sel.at(i).node));
  }
  return boundsToRect(b) || { x: 0, y: 0, width: 1, height: 1 };
}

function getArtboards(spread) {
  try {
    if (spread && spread.artboards && spread.artboards.length) {
      const out = [];
      for (let i = 0; i < spread.artboards.length; i++) out.push(spread.artboards[i]);
      return out;
    }
  } catch (e) {}
  return [];
}

function getSpreadArea(doc) {
  try {
    const b = rectToPlain(doc.currentSpread.getSpreadExtents({ includeSpread: true }));
    if (b && b.width > 0 && b.height > 0) return b;
  } catch (e) {}
  return null;
}

function getTargetArea(doc, selectionBounds) {
  const spread = doc.currentSpread;
  const selCenter = rectCenter(selectionBounds);
  const artboards = getArtboards(spread);
  for (let i = 0; i < artboards.length; i++) {
    const abBox = getNodeBox(artboards[i]);
    if (abBox && containsPoint(abBox, selCenter.x, selCenter.y)) {
      return { area: abBox, label: "artboard" };
    }
  }
  const spreadArea = getSpreadArea(doc);
  if (spreadArea) return { area: spreadArea, label: "page" };
  return { area: selectionBounds, label: "selection bounds" };
}

function createGroup(doc, name) {
  const b = AddChildNodesCommandBuilder.create();
  b.setInsertionTarget(doc.currentSpread);
  b.addContainerNode(ContainerNodeDefinition.create(name));
  const cmd = b.createCommand(false, NodeChildType.Main);
  exec(doc, cmd);
  return cmd.newNodes && cmd.newNodes.length ? cmd.newNodes[0] : null;
}

function moveInto(doc, nodes, container) {
  const valid = nodes.filter(Boolean);
  if (!valid.length || !container) return;
  exec(doc, DocumentCommand.createMoveNodes(
    Selection.create(doc, valid, true),
    container,
    NodeMoveType.Inside,
    NodeChildType.Main
  ));
}

function duplicateTransformed(doc, sourceNodes, xf) {
  const srcSel = Selection.create(doc, sourceNodes, true);
  const cmd = DocumentCommand.createTransform(srcSel, xf, {
    duplicateNodes: true,
    cloneRaster: true,
    correctChildren: true
  });
  exec(doc, cmd);
  return cmd.newNodes || [];
}

function restoreSelection(doc, nodes) {
  try {
    exec(doc, DocumentCommand.createSetSelection(Selection.create(doc, nodes.filter(Boolean), true)));
  } catch (e) {}
}

function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readFillHSL(node) {
  try {
    const fd = node.brushFillDescriptor;
    if (!fd || !fd.fill || !fd.fill.colour) return null;
    return fd.fill.colour.hslaf;
  } catch (e) {
    return null;
  }
}

function findFirstHSL(nodes) {
  for (const n of nodes) {
    let hsl = readFillHSL(n);
    if (hsl) return hsl;
    let child = n.firstChild;
    while (child) {
      hsl = readFillHSL(child);
      if (hsl) return hsl;
      child = child.nextSibling;
    }
  }
  return null;
}

function collectBrushFillTargets(nodes) {
  const targets = [];
  function visit(node) {
    if (!node) return;
    try {
      const fd = node.brushFillDescriptor;
      const hsl = fd && fd.fill && fd.fill.colour ? fd.fill.colour.hslaf : null;
      if (hsl) targets.push({ node, descriptor: fd, hsl });
    } catch (e) {}
    let child = null;
    try { child = node.firstChild; } catch (e) {}
    while (child) {
      visit(child);
      try { child = child.nextSibling; } catch (e) { child = null; }
    }
  }
  for (const node of nodes) visit(node);
  return targets;
}

function shiftedFillDescriptor(hsl, hueDelta) {
  const newH = ((hsl.h + hueDelta) % 1.0 + 1.0) % 1.0;
  const newCol = Colour.createHSLAf({ h: newH, s: hsl.s, l: hsl.l, alpha: hsl.alpha });
  return FillDescriptor.createSolid(SolidFill.create(newCol));
}

function shiftNodeHue(doc, node, hslFallback, hueDelta) {
  let count = 0;
  if (Math.abs(hueDelta) < 0.0001) return 0;
  try {
    const hsl = readFillHSL(node) || hslFallback;
    if (hsl) {
      doc.setBrushFillDescriptor(shiftedFillDescriptor(hsl, hueDelta), node);
      count++;
    }
  } catch (e) {}
  let child = node.firstChild;
  while (child) {
    count += shiftNodeHue(doc, child, hslFallback, hueDelta);
    child = child.nextSibling;
  }
  return count;
}

function makeTiles(patType, cols, rows, unitW, unitH, stagger, rng) {
  const tiles = [];
  const total = cols * rows;
  const stg = stagger / 100;
  const cx = (cols - 1) * unitW / 2;
  const cy = (rows - 1) * unitH / 2;

  switch (patType) {
    case 0:
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
        tiles.push({ dx: c * unitW, dy: r * unitH, rot: 0 });
      break;
    case 1:
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
        tiles.push({ dx: c * unitW + (r % 2 ? unitW * stg : 0), dy: r * unitH, rot: 0 });
      break;
    case 2:
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
        tiles.push({ dx: c * unitW, dy: r * unitH + (c % 2 ? unitH * stg : 0), rot: 0 });
      break;
    case 3:
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const gx = c * unitW - cx;
        const gy = r * unitH - cy;
        const ang = Math.PI / 4;
        tiles.push({
          dx: gx * Math.cos(ang) - gy * Math.sin(ang) + cx,
          dy: gx * Math.sin(ang) + gy * Math.cos(ang) + cy,
          rot: 0
        });
      }
      break;
    case 4:
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
        tiles.push({ dx: c * unitW + (r % 2 ? unitW * 0.5 : 0), dy: r * unitH * 0.8660254, rot: 0 });
      break;
    case 5:
      tiles.push({ dx: 0, dy: 0, rot: 0 });
      for (let ring = 1; ring <= cols; ring++) {
        const count = rows * ring;
        const radius = ring * unitW;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * 2 * Math.PI;
          tiles.push({ dx: Math.cos(a) * radius, dy: Math.sin(a) * radius, rot: 0 });
        }
      }
      break;
    case 6:
      for (let i = 0; i < total; i++) {
        const a = i * Math.PI * (3 - Math.sqrt(5));
        const r = Math.sqrt(i) * unitW * 0.6;
        tiles.push({ dx: Math.cos(a) * r, dy: Math.sin(a) * r, rot: 0 });
      }
      break;
    case 7: {
      const wAmp = unitH * stg;
      const wFreq = 2 * Math.PI / Math.max(1, cols - 1);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
        tiles.push({ dx: c * unitW, dy: r * unitH + Math.sin(c * wFreq) * wAmp, rot: 0 });
      break;
    }
    case 8: {
      const radiusStep = Math.max(unitW, unitH) * 0.85;
      tiles.push({ dx: 0, dy: 0, rot: 0 });
      for (let ring = 1; ring <= cols; ring++) {
        const count = Math.max(3, rows * ring);
        const ringTwist = ring * stg * Math.PI / Math.max(1, cols);
        const radius = ring * radiusStep;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * 2 * Math.PI + ringTwist;
          tiles.push({
            dx: Math.cos(a) * radius,
            dy: Math.sin(a) * radius,
            rot: a * 180 / Math.PI + 90 + stg * 180
          });
        }
      }
      break;
    }
    case 9:
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        tiles.push({
          dx: c * unitW + (rng() - 0.5) * unitW * stg,
          dy: r * unitH + (rng() - 0.5) * unitH * stg,
          rot: rng() * 360 * stg
        });
      }
      break;
  }

  return tiles;
}

function rotatePoint(x, y, cx, cy, radians) {
  if (!radians) return { x, y };
  const dx = x - cx;
  const dy = y - cy;
  const ca = Math.cos(radians);
  const sa = Math.sin(radians);
  return { x: cx + dx * ca - dy * sa, y: cy + dx * sa + dy * ca };
}

function transformedBox(box, relDX, relDY, rotDeg, rotCX, rotCY) {
  const rad = (rotDeg || 0) * Math.PI / 180;
  const pts = [
    { x: box.x + relDX, y: box.y + relDY },
    { x: rectRight(box) + relDX, y: box.y + relDY },
    { x: rectRight(box) + relDX, y: rectBottom(box) + relDY },
    { x: box.x + relDX, y: rectBottom(box) + relDY }
  ];
  let b = null;
  for (const p of pts) {
    const q = rotatePoint(p.x, p.y, rotCX, rotCY, rad);
    b = addPointToBounds(b, q.x, q.y);
  }
  return boundsToRect(b);
}

function getPatternRawBounds(sourceBoxes, selectionBounds, tiles) {
  if (!tiles.length) return selectionBounds;
  const ox = tiles[0].dx;
  const oy = tiles[0].dy;
  let b = null;
  for (const tile of tiles) {
    const relDX = tile.dx - ox;
    const relDY = tile.dy - oy;
    const tcx = selectionBounds.x + selectionBounds.width / 2 + relDX;
    const tcy = selectionBounds.y + selectionBounds.height / 2 + relDY;
    for (const box of sourceBoxes) {
      b = addRectToBounds(b, transformedBox(box, relDX, relDY, tile.rot, tcx, tcy));
    }
  }
  return boundsToRect(b) || selectionBounds;
}

function computeFit(rawBox, targetArea) {
  if (!rawBox || !targetArea || rawBox.width <= 0 || rawBox.height <= 0) {
    return { scale: 1, dx: 0, dy: 0, rawCenter: rectCenter(rawBox || targetArea || { x: 0, y: 0, width: 1, height: 1 }) };
  }

  const scale = Math.min(
    1,
    targetArea.width / Math.max(1, rawBox.width),
    targetArea.height / Math.max(1, rawBox.height)
  );
  const rawCenter = rectCenter(rawBox);
  const scaled = {
    x: rawCenter.x + (rawBox.x - rawCenter.x) * scale,
    y: rawCenter.y + (rawBox.y - rawCenter.y) * scale,
    width: rawBox.width * scale,
    height: rawBox.height * scale
  };

  let dx = 0;
  let dy = 0;
  if (scaled.x < targetArea.x) dx = targetArea.x - scaled.x;
  if (scaled.x + dx + scaled.width > rectRight(targetArea)) dx = rectRight(targetArea) - (scaled.x + scaled.width);
  if (scaled.y < targetArea.y) dy = targetArea.y - scaled.y;
  if (scaled.y + dy + scaled.height > rectBottom(targetArea)) dy = rectBottom(targetArea) - (scaled.y + scaled.height);

  return { scale, dx, dy, rawCenter };
}

function fitTransformFrom(fit) {
  const c = fit.rawCenter || { x: 0, y: 0 };
  let t = Transform.createTranslate(fit.dx || 0, fit.dy || 0);
  if (Math.abs((fit.scale || 1) - 1) > 0.0001) {
    t = t
      .multiply(Transform.createTranslate(c.x, c.y))
      .multiply(Transform.createScale(fit.scale, fit.scale))
      .multiply(Transform.createTranslate(-c.x, -c.y));
  }
  return t;
}

function needsFit(fit) {
  return Math.abs(fit.dx || 0) > 0.001 ||
    Math.abs(fit.dy || 0) > 0.001 ||
    Math.abs((fit.scale || 1) - 1) > 0.0001;
}

function tileTransform(selectionBounds, tile, firstTile, fitTransform, applyFit) {
  const relDX = tile.dx - firstTile.dx;
  const relDY = tile.dy - firstTile.dy;
  let t = Transform.createTranslate(relDX, relDY);
  if (tile.rot !== 0) {
    const tcx = selectionBounds.x + selectionBounds.width / 2 + relDX;
    const tcy = selectionBounds.y + selectionBounds.height / 2 + relDY;
    t = Transform.createRotate(tile.rot * Math.PI / 180, tcx, tcy).multiply(t);
  }
  return applyFit ? fitTransform.multiply(t) : t;
}

function safetyFitGroup(doc, group, targetArea) {
  const box = getNodeBox(group);
  if (!box || !targetArea) return false;
  const fit = computeFit(box, targetArea);
  if (!needsFit(fit)) return false;
  try {
    exec(doc, DocumentCommand.createTransform(
      Selection.create(doc, [group], true),
      fitTransformFrom(fit),
      { mergeable: false }
    ));
    return true;
  } catch (e) {
    return false;
  }
}

function getTilePlan(sourceNodes, selectionBounds, opts, targetSpec) {
  const unitW = Math.max(1, (selectionBounds.width || 1) + opts.gapX);
  const unitH = Math.max(1, (selectionBounds.height || 1) + opts.gapY);
  const rng = makeRng(opts.seed);
  const tiles = makeTiles(opts.patType, opts.cols, opts.rows, unitW, unitH, opts.stagger, rng);
  if (!tiles.length) throw new Error("No tiles were generated.");

  const sourceBoxes = sourceNodes.map(getNodeBox).filter(Boolean);
  if (!sourceBoxes.length) throw new Error("Could not read the selected object's bounds.");

  const rawBox = getPatternRawBounds(sourceBoxes, selectionBounds, tiles);
  const fit = computeFit(rawBox, targetSpec.area);
  const fitXf = fitTransformFrom(fit);
  const applyFit = needsFit(fit);

  return { tiles, fit, fitXf, applyFit };
}

function createPatternPreviewCommand(doc, sourceNodes, selectionBounds, opts, targetSpec) {
  const plan = getTilePlan(sourceNodes, selectionBounds, opts, targetSpec);
  const firstTile = plan.tiles[0];
  const cb = CompoundCommandBuilder.create();
  const fillTargets = opts.hueShift > 0 ? collectBrushFillTargets(sourceNodes) : [];

  for (let i = 0; i < plan.tiles.length; i++) {
    if (fillTargets.length) {
      const hueDelta = (i / Math.max(1, plan.tiles.length - 1)) * (opts.hueShift / 360);
      for (const target of fillTargets) {
        cb.addCommand(DocumentCommand.createSetBrushFill(
          Selection.create(doc, [target.node], true),
          shiftedFillDescriptor(target.hsl, hueDelta)
        ));
      }
    }

    const t = tileTransform(selectionBounds, plan.tiles[i], firstTile, plan.fitXf, plan.applyFit);
    cb.addCommand(DocumentCommand.createTransform(
      Selection.create(doc, sourceNodes, true),
      t,
      {
        duplicateNodes: true,
        cloneRaster: true,
        correctChildren: true
      }
    ));
  }

  for (const target of fillTargets) {
    cb.addCommand(DocumentCommand.createSetBrushFill(
      Selection.create(doc, [target.node], true),
      target.descriptor
    ));
  }
  cb.addCommand(DocumentCommand.createSetSelection(Selection.create(doc, sourceNodes, true)));
  return {
    command: cb.createCommand(),
    tiles: plan.tiles.length,
    nodes: sourceNodes.length * plan.tiles.length,
    scale: plan.fit.scale,
    fitApplied: plan.applyFit,
    targetLabel: targetSpec.label
  };
}

function generate(doc, sourceNodes, selectionBounds, opts, targetSpec, finalName) {
  const plan = getTilePlan(sourceNodes, selectionBounds, opts, targetSpec);
  const srcHSL = findFirstHSL(sourceNodes);

  const dupNodes = [];
  const firstTile = plan.tiles[0];

  for (let i = 0; i < plan.tiles.length; i++) {
    const tile = plan.tiles[i];
    const t = tileTransform(selectionBounds, tile, firstTile, plan.fitXf, plan.applyFit);
    const start = dupNodes.length;

    const newNodes = duplicateTransformed(doc, sourceNodes, t);
    for (const node of newNodes) dupNodes.push(node);

    if (opts.hueShift > 0 && srcHSL) {
      const hueDelta = (i / Math.max(1, plan.tiles.length - 1)) * (opts.hueShift / 360);
      for (let j = start; j < dupNodes.length; j++) {
        shiftNodeHue(doc, dupNodes[j], srcHSL, hueDelta);
      }
    }
  }

  if (!dupNodes.length) throw new Error("Could not duplicate the selected object.");

  const label = finalName || `${PATTERN_NAMES[opts.patType]} ${opts.cols}x${opts.rows}`;
  const group = createGroup(doc, label);
  moveInto(doc, dupNodes, group);
  const safetyFit = safetyFitGroup(doc, group, targetSpec.area);

  return {
    group,
    nodes: dupNodes.length,
    tiles: plan.tiles.length,
    scale: plan.fit.scale,
    fitApplied: plan.applyFit || safetyFit,
    targetLabel: targetSpec.label
  };
}

function showError(title, msg) {
  const d = Dialog.create(title);
  d.initialWidth = 460;
  d.addColumn().addGroup("").addStaticText("", msg).isFullWidth = true;
  d.runModal();
}

function slider(group, label, value, min, max, precision, desc) {
  const c = group.addUnitValueEditor(label, UnitType.Number, UnitType.Number, value, min, max);
  c.precision = precision;
  c.showPopupSlider = true;
  if (desc) c.description = desc;
  return c;
}

function main() {
  const doc = Document.current;
  if (!doc) return showError("Tile Generator", "No document is open.");

  const sel = doc.selection;
  if (!sel || sel.length === 0) {
    return showError("Tile Generator", "Select at least one object to tile.");
  }

  const sourceNodes = [];
  for (let i = 0; i < sel.length; i++) sourceNodes.push(sel.at(i).node);
  const selectionBounds = getSelectionBounds(sel);
  const targetSpec = getTargetArea(doc, selectionBounds);

  const dlg = Dialog.create("Tile Generator");
  dlg.initialWidth = 320;
  dlg.isResizable = true;
  const col = dlg.addColumn();

  const typeGrp = col.addGroup("Pattern");
  const typeCtrl = typeGrp.addComboBox("Type", PATTERN_NAMES, 0);
  typeCtrl.isFullWidth = true;

  const gridGrp = col.addGroup("Layout");
  const colsCtrl = slider(gridGrp, "Columns / Rings", 5, 1, CONTROL_VALUE_MAX, 0, "Grid columns, or rings for radial burst.");
  const rowsCtrl = slider(gridGrp, "Rows / Per Ring", 5, 1, CONTROL_VALUE_MAX, 0, "Grid rows, or items per ring for radial burst.");

  const spaceGrp = col.addGroup("Spacing");
  const gapXCtrl = slider(spaceGrp, "Gap X", 10, -5000, 5000, 1, "Horizontal spacing added to the selected object's width.");
  const gapYCtrl = slider(spaceGrp, "Gap Y", 10, -5000, 5000, 1, "Vertical spacing added to the selected object's height.");
  const staggerCtrl = slider(spaceGrp, "Stagger / Wave / Scatter %", 50, 0, 100, 0, "Controls row offsets, wave height, pinwheel rotation, or scatter strength.");

  const colourGrp = col.addGroup("Colour");
  const colourNote = colourGrp.addStaticText("", "Set colour shift above 0 deg to rotate solid fills across the generated tiles. Leave it at 0 for no colour change.");
  colourNote.isFullWidth = true;
  const hueCtrl = slider(colourGrp, "Colour shift (deg)", 0, 0, 360, 0, "Rotates solid fills across the generated tiles. 0 keeps original colours.");

  const outputGrp = col.addGroup("Output");
  const fitNote = outputGrp.addStaticText(
    "",
    `Preview fits the current ${targetSpec.label}. OK creates the group; Cancel removes the preview.`
  );
  fitNote.isFullWidth = true;
  const statusTxt = outputGrp.addStaticText("", "Opening preview...");
  statusTxt.isFullWidth = true;

  function getOpts() {
    return {
      cols: Math.max(1, Math.round(colsCtrl.value)),
      rows: Math.max(1, Math.round(rowsCtrl.value)),
      gapX: gapXCtrl.value,
      gapY: gapYCtrl.value,
      patType: Math.max(0, Math.min(PATTERN_NAMES.length - 1, typeCtrl.selectedIndex)),
      stagger: staggerCtrl.value,
      hueShift: hueCtrl.value,
      seed: DEFAULT_RANDOM_SEED
    };
  }

  let previewQueued = false;
  let previewSerial = 0;
  let lastPreviewWasInitial = false;
  let dialogActive = true;

  function runPreview(initial) {
    if (!dialogActive) return;
    try {
      const opts = getOpts();
      const res = createPatternPreviewCommand(doc, sourceNodes, selectionBounds, opts, targetSpec);
      exec(doc, res.command, true);
      const scaleText = res.fitApplied && Math.abs((res.scale || 1) - 1) > 0.0001 ? `, ${(res.scale * 100).toFixed(0)}%` : "";
      statusTxt.text =
        `${initial ? "Preview" : "Updated"}: ${PATTERN_NAMES[opts.patType]} ` +
        `${opts.cols}x${opts.rows}, ${res.nodes} node(s), ${res.targetLabel}${scaleText}`;
    } catch (e) {
      statusTxt.text = "Preview error: " + (e && e.message ? e.message : e);
      console.log("Tile Generator preview error: " + (e && e.stack ? e.stack : e));
    }
  }

  function schedulePreview(initial) {
    if (!dialogActive) return;
    previewSerial++;
    lastPreviewWasInitial = !!initial;
    if (previewQueued) return;
    previewQueued = true;
    setImmediate(function () {
      const serial = previewSerial;
      const initialRun = lastPreviewWasInitial;
      previewQueued = false;
      runPreview(initialRun);
      if (serial !== previewSerial) schedulePreview(false);
    });
  }

  for (const ctrl of [typeCtrl, colsCtrl, rowsCtrl, gapXCtrl, gapYCtrl, staggerCtrl, hueCtrl]) {
    ctrl.onValueChangedHandler = function () { schedulePreview(false); };
  }

  schedulePreview(true);

  const result = dlg.runModal();
  dialogActive = false;
  if (result.value === DialogResult.Ok.value) {
    try {
      const opts = getOpts();
      const previewGroup = generate(doc, sourceNodes, selectionBounds, opts, targetSpec, `${PATTERN_NAMES[opts.patType]} ${opts.cols}x${opts.rows}`).group;
      exec(doc, DocumentCommand.createSetSelection(Selection.create(doc, [previewGroup], true)));
    } catch (e) {
      restoreSelection(doc, sourceNodes);
      showError("Tile Generator - Apply error", String(e && e.stack ? e.stack : e));
    }
  } else {
    restoreSelection(doc, sourceNodes);
  }
}

try {
  main();
} catch (err) {
  showError("Tile Generator - Crash", String(err && err.stack ? err.stack : err));
}
