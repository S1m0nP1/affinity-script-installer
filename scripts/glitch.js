// @title Glitch
// @description Creates an editable vector glitch effect from selected shapes or curves. A live preview appears in the document and updates as you adjust the bands, chance, angle, shift, noise, smoothness and variation. OK keeps the generated Glitch group; Cancel removes it.
// @author S1m0nP1
// @version 1.1.0
// @affinity 3.2+
// @verified true
// @homepage https://affinityhub.js.org/
// @github https://github.com/S1m0nP1/affinity-script-installer
// @tags vector, glitch, distortion, effect
// @image images/glitch.png

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
const { CurveBuilder, PolyCurve, Transform } = require("/geometry");
const { UnitType } = require("/units");
const { setImmediate } = require("/timers");

const PREVIEW_NODE_CAP = 60;
const SAMPLE_CAP = 1600;

function exec(doc, cmd) {
  return doc.executeCommand(cmd, false);
}

function showMessage(title, msg) {
  const d = Dialog.create(title);
  d.initialWidth = 340;
  d.isResizable = true;
  const g = d.addColumn().addGroup("");
  const t = g.addStaticText("", msg);
  t.isFullWidth = true;
  d.runModal();
}

function selectedNodes(doc) {
  try {
    if (doc.selection && doc.selection.nodes && typeof doc.selection.nodes.toArray === "function") {
      return doc.selection.nodes.toArray();
    }
  } catch (e) {}

  const out = [];
  try {
    const sel = doc.selection;
    for (let i = 0; sel && i < sel.length; i++) out.push(sel.at(i).node);
  } catch (e) {}
  return out.filter(Boolean);
}

function isVectorCandidate(n) {
  return !!(n && (n.isPolyCurveNode || n.isShapeNode || (n.isVectorNode && n.polyCurve)));
}

function createGroup(doc, name) {
  const b = AddChildNodesCommandBuilder.create();
  b.setInsertionTarget(doc.currentSpread);
  b.addContainerNode(ContainerNodeDefinition.create(name));
  const cmd = b.createCommand(false, NodeChildType.Main);
  exec(doc, cmd);
  return cmd.newNodes && cmd.newNodes.length ? cmd.newNodes[0] : null;
}

function deleteNodeSafe(doc, node) {
  if (!node) return;
  try {
    exec(doc, DocumentCommand.createDeleteSelection(Selection.create(doc, [node], true)));
  } catch (e) {}
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

function duplicateNodes(doc, sourceNodes) {
  const cmd = DocumentCommand.createTransform(
    Selection.create(doc, sourceNodes, true),
    Transform.createTranslate(0, 0),
    {
      duplicateNodes: true,
      cloneRaster: true,
      correctChildren: true
    }
  );
  exec(doc, cmd);
  return cmd.newNodes || [];
}

function restoreSelection(doc, nodes) {
  try {
    exec(doc, DocumentCommand.createSetSelection(Selection.create(doc, nodes, true)));
  } catch (e) {}
}

function convertToCurves(doc, nodes) {
  const curves = [];
  const convert = [];

  for (const n of nodes) {
    if (!n) continue;
    if (n.isPolyCurveNode) curves.push(n);
    else if (isVectorCandidate(n)) convert.push(n);
  }

  if (convert.length) {
    exec(doc, DocumentCommand.createConvertToCurves(Selection.create(doc, convert, true)));
    const converted = selectedNodes(doc).filter((n) => n && n.isPolyCurveNode);
    for (const n of converted) curves.push(n);
  }

  return curves;
}

function evalBez(b, t) {
  const u = 1 - t;
  return {
    x: u * u * u * b.start.x + 3 * u * u * t * b.c1.x + 3 * u * t * t * b.c2.x + t * t * t * b.end.x,
    y: u * u * u * b.start.y + 3 * u * u * t * b.c1.y + 3 * u * t * t * b.c2.y + t * t * t * b.end.y
  };
}

function plainPoint(p) {
  return { x: p.x, y: p.y };
}

function snapshotBeziers(curve) {
  const out = [];
  for (const b of curve.beziers || []) {
    out.push({
      start: plainPoint(b.start),
      c1: plainPoint(b.c1),
      c2: plainPoint(b.c2),
      end: plainPoint(b.end)
    });
  }
  return out;
}

function buildArcTable(beziers, samplesPerBezier) {
  const tbl = [];
  let cum = 0;
  for (let bi = 0; bi < beziers.length; bi++) {
    const b = beziers[bi];
    let prev = evalBez(b, 0);
    if (bi === 0) tbl.push({ bi, t: 0, cum: 0 });
    for (let s = 1; s <= samplesPerBezier; s++) {
      const t = s / samplesPerBezier;
      const pt = evalBez(b, t);
      cum += Math.hypot(pt.x - prev.x, pt.y - prev.y);
      tbl.push({ bi, t, cum });
      prev = pt;
    }
  }
  return tbl;
}

function sampleAt(tbl, beziers, c) {
  let lo = 0;
  let hi = tbl.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (tbl[mid].cum <= c) lo = mid;
    else hi = mid;
  }
  const a = tbl[lo];
  const b = tbl[hi];
  const span = b.cum - a.cum;
  const f = span < 1e-9 ? 0 : (c - a.cum) / span;
  return evalBez(beziers[f < 0.5 ? a.bi : b.bi], a.t + (b.t - a.t) * f);
}

function createPRNG(seed) {
  let value = seed;
  return function () {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

function buildGlitchedCurves(node, config, prng) {
  const outBase = PolyCurve.create();
  const angleRad = config.angle * Math.PI / 180;
  const shiftXDir = Math.cos(angleRad);
  const shiftYDir = Math.sin(angleRad);
  const sliceXDir = -Math.sin(angleRad);
  const sliceYDir = Math.cos(angleRad);

  for (const curve of node.polyCurve) {
    const beziers = snapshotBeziers(curve);
    if (!beziers.length) continue;

    const samplesPerBezier = Math.max(12, Math.min(120, Math.round(SAMPLE_CAP / Math.max(1, beziers.length))));
    const tbl = buildArcTable(beziers, samplesPerBezier);
    const totalLen = tbl[tbl.length - 1].cum;
    if (totalLen <= 0) continue;

    const segments = Math.max(24, Math.min(SAMPLE_CAP, Math.floor(totalLen / Math.max(2, config.detail))));
    const step = totalLen / segments;
    const closed = !!curve.isClosed;
    const count = closed ? segments - 1 : segments;
    const basePts = [];
    let minProj = Infinity;
    let maxProj = -Infinity;

    for (let i = 0; i <= count; i++) {
      const pt = sampleAt(tbl, beziers, Math.min(i * step, totalLen));
      basePts.push(pt);
      const proj = pt.x * sliceXDir + pt.y * sliceYDir;
      minProj = Math.min(minProj, proj);
      maxProj = Math.max(maxProj, proj);
    }

    if (basePts.length < 2) continue;

    const numSlices = Math.max(1, config.slices);
    const sliceHeight = Math.max(1e-6, (maxProj - minProj) / numSlices);
    const sliceMap = [];
    for (let i = 0; i < numSlices; i++) {
      let blockShift = 0;
      if (prng() < config.chaos / 100) {
        blockShift = (prng() * 2 - 1) * config.intensity;
        blockShift += (prng() * 2 - 1) * config.jitter;
      }
      sliceMap.push(blockShift);
    }

    const finalPts = [];
    for (const pt of basePts) {
      const proj = pt.x * sliceXDir + pt.y * sliceYDir;
      let sliceIdx = Math.floor((proj - minProj) / sliceHeight);
      sliceIdx = Math.max(0, Math.min(numSlices - 1, sliceIdx));
      const shift = sliceMap[sliceIdx];
      finalPts.push({
        x: pt.x + shift * shiftXDir,
        y: pt.y + shift * shiftYDir
      });
    }

    const builder = CurveBuilder.create();
    builder.beginXY(finalPts[0].x, finalPts[0].y);
    const loopCount = closed ? finalPts.length : finalPts.length - 1;
    for (let i = 1; i <= loopCount; i++) {
      const p = finalPts[i % finalPts.length];
      builder.lineToXY(p.x, p.y);
    }
    if (closed) builder.close();
    outBase.addCurve(builder.createCurve());
  }

  return outBase;
}

function applyGlitchToCurveNodes(doc, curveNodes, config) {
  const prng = createPRNG(config.seed);
  const cb = CompoundCommandBuilder.create();
  let changed = 0;

  for (const node of curveNodes) {
    if (!node || !node.polyCurve || !node.curvesInterface) continue;
    const glitched = buildGlitchedCurves(node, config, prng);
    cb.addCommand(DocumentCommand.createSetCurves(node.curvesInterface, glitched));
    changed++;
  }

  if (!changed) throw new Error("No curve nodes could be glitched.");
  exec(doc, cb.createCommand());
  return changed;
}

function buildGlitchPreview(doc, sourceNodes, config, name) {
  if (sourceNodes.length > PREVIEW_NODE_CAP) {
    throw new Error(`Preview is capped at ${PREVIEW_NODE_CAP} selected objects.`);
  }

  const group = createGroup(doc, name);
  if (!group) throw new Error("Could not create preview group.");

  const copies = duplicateNodes(doc, sourceNodes);
  moveInto(doc, copies, group);
  const curveNodes = convertToCurves(doc, copies);
  const changed = applyGlitchToCurveNodes(doc, curveNodes, config);

  return { group, copies: copies.length, changed };
}

function main() {
  const doc = Document.current;
  if (!doc) return showMessage("Glitch", "Please open a document first.");

  const sourceNodes = selectedNodes(doc).filter(isVectorCandidate);
  if (!sourceNodes.length) {
    return showMessage("Glitch", "Please select one or more vector curves or shapes.");
  }

  const dlg = Dialog.create("Glitch");
  dlg.initialWidth = 320;
  dlg.isResizable = true;
  const col = dlg.addColumn();

  function note(group, text) {
    const s = group.addStaticText("", text);
    s.isFullWidth = true;
    return s;
  }

  function slider(group, label, value, min, max, precision, desc) {
    const c = group.addUnitValueEditor(label, UnitType.Number, UnitType.Number, value, min, max);
    c.precision = precision;
    c.showPopupSlider = true;
    if (desc) c.description = desc;
    return c;
  }

  const mapGrp = col.addGroup("Pattern");
  const sliceCtrl = slider(mapGrp, "Bands", 25, 2, 200, 0, "Number of glitch strips.");
  const chaosCtrl = slider(mapGrp, "Chance", 35, 0, 100, 0, "How often a band moves.");
  const angleCtrl = slider(mapGrp, "Angle", 0, -180, 180, 1, "Direction the bands move.");

  const dmgGrp = col.addGroup("Amount");
  const intensityCtrl = slider(dmgGrp, "Shift", 40, 0, 1000, 0, "How far moved bands shift.");
  const jitterCtrl = slider(dmgGrp, "Noise", 5, 0, 200, 1, "Adds uneven movement.");
  const detailCtrl = slider(dmgGrp, "Smoothness", 2, 1, 20, 1, "Lower is sharper; higher is lighter.");

  const seedGrp = col.addGroup("Variation");
  const seedCtrl = slider(seedGrp, "Pattern", 1337, 1, 99999, 0, "Change this number for a different random layout. The same number gives the same result.");

  const outGrp = col.addGroup("Preview");
  note(outGrp, "OK keeps the Glitch group. Cancel removes it.");
  const statusTxt = outGrp.addStaticText("", "Opening preview...");
  statusTxt.isFullWidth = true;

  function getConfig() {
    return {
      slices: Math.max(1, Math.round(sliceCtrl.value)),
      chaos: Math.max(0, Math.min(100, chaosCtrl.value)),
      angle: angleCtrl.value,
      intensity: Math.max(0, intensityCtrl.value),
      jitter: Math.max(0, jitterCtrl.value),
      detail: Math.max(1, detailCtrl.value),
      seed: Math.max(1, Math.round(seedCtrl.value))
    };
  }

  let previewGroup = null;
  let updating = false;

  function clearPreview() {
    if (previewGroup) {
      deleteNodeSafe(doc, previewGroup);
      previewGroup = null;
    }
    restoreSelection(doc, sourceNodes);
  }

  function showPreview(initial) {
    if (updating) return;
    updating = true;
    try {
      clearPreview();
      const cfg = getConfig();
      const res = buildGlitchPreview(doc, sourceNodes, cfg, "Glitch Preview");
      previewGroup = res.group;
      restoreSelection(doc, sourceNodes);
      statusTxt.text =
        `${initial ? "Preview" : "Updated"}: ${cfg.slices} bands, ` +
        `${cfg.chaos.toFixed(0)}% chance, ${res.changed} curve node(s)`;
    } catch (e) {
      statusTxt.text = "Preview error: " + (e && e.message ? e.message : e);
      console.log("Glitch preview error: " + (e && e.stack ? e.stack : e));
    } finally {
      updating = false;
    }
  }

  for (const ctrl of [sliceCtrl, chaosCtrl, angleCtrl, intensityCtrl, jitterCtrl, detailCtrl, seedCtrl]) {
    ctrl.onValueChangedHandler = function () { showPreview(false); };
  }

  setImmediate(function () { showPreview(true); });

  const result = dlg.runModal();
  if (result.value === DialogResult.Ok.value) {
    try {
      if (!previewGroup) {
        previewGroup = buildGlitchPreview(doc, sourceNodes, getConfig(), "Glitch").group;
      }
      exec(doc, DocumentCommand.createSetDescription(
        Selection.create(doc, [previewGroup], true),
        "Glitch"
      ));
      exec(doc, DocumentCommand.createSetSelection(Selection.create(doc, [previewGroup], true)));
    } catch (e) {
      showMessage("Glitch - Apply error", String(e && e.stack ? e.stack : e));
    }
  } else {
    clearPreview();
  }
}

try {
  main();
} catch (err) {
  showMessage("Glitch - Crash", String(err && err.stack ? err.stack : err));
}
