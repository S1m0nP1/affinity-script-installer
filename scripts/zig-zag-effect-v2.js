'use strict';
// @id zigzag
// @title Zigzag
// @description Converts selected curves, shapes, or groups into a live-preview zigzag path effect, including support for closed paths.
// @author BlackMortimer-13
// @version 2.5
// @affinity 3.2+
// @verified false
// @homepage 
// @github 
// @tags effect, vector
// @image images/ZigZag.png

// ZIG ZAG EFFECT v2.5 - CLOSED PATHS FIX - Affinity Designer
//
// Keeps the v2.5 zig-zag algorithm, but fixes closed Shape/path objects:
// - preview commands are explicitly executed as preview state
// - every preview is rebuilt from each object's original curvesInterface data
// - selected groups are expanded recursively to all vector children
// - multiple selected objects are processed together
// - ShapeNodes / non-mutable curve interfaces are converted to mutable curves first
// - closed paths use the exact v1 curve.beziers sampling path
// - the initial field values are previewed as soon as the dialog opens
// - Cancel clears previews and restores the starting history position, including conversion
// - OK clears previews, then applies the final curve change once

const { Document } = require('/document');
const { DocumentCommand, CompoundCommandBuilder } = require('/commands');
const { CurveBuilder, PolyCurve } = require('/geometry');
const { Dialog, DialogResult } = require('/dialog');
const { Selection } = require('/selections');

const doc = Document.current;

if (!doc) {
  alert('Open a document first.');
} else {
  const rawNodes = getSelectedVectorNodes();

  if (!rawNodes.length) {
    alert('Select one or more vector curves, shapes, or groups first.');
  } else {
    main(rawNodes);
  }
}

function isZigZagCandidate(n) {
  if (!n) return false;

  try {
    return !!(n.curvesInterface && n.curvesInterface.polyCurve);
  } catch (e) {
    return false;
  }
}

function pushUnique(nodes, node) {
  if (!node) return;

  for (const existing of nodes) {
    try {
      if (existing.isSameNode && existing.isSameNode(node)) return;
    } catch (e) {
      // Ignore stale handles left behind by conversion/history changes.
    }
  }

  nodes.push(node);
}

function collectVectorNodes(selectedNodes) {
  const nodes = [];

  function visit(node) {
    if (!node) return;

    let child = null;
    try {
      child = node.firstChild;
    } catch (e) {
      child = null;
    }

    if ((node.isGroupNode || node.isContainerNode) && child) {
      while (child) {
        visit(child);

        try {
          child = child.nextSibling;
        } catch (e) {
          child = null;
        }
      }
      return;
    }

    if (isZigZagCandidate(node)) {
      pushUnique(nodes, node);
    }

    while (child) {
      visit(child);

      try {
        child = child.nextSibling;
      } catch (e) {
        child = null;
      }
    }
  }

  for (const node of selectedNodes || []) {
    visit(node);
  }

  return nodes;
}

function collectVectorNodesViaSelectionItems(selection) {
  const nodes = [];

  let items = null;
  try {
    items = selection.items;
  } catch (e) {
    items = null;
  }

  if (!items) return nodes;

  for (const item of items) {
    let node = null;
    try {
      node = item.node;
    } catch (e) {
      node = null;
    }

    for (const target of collectVectorNodes([node])) {
      pushUnique(nodes, target);
    }
  }

  return nodes;
}

function getSelectedVectorNodes() {
  const nodes = collectVectorNodesViaSelectionItems(doc.selection);
  if (nodes.length) return nodes;

  try {
    return collectVectorNodes(doc.selection.nodes.toArray());
  } catch (e) {
    return [];
  }
}

function main(rawNodes) {
  const historyStart = doc.history.position;
  const nodes = ensureMutableCurveNodes(rawNodes);

  if (!nodes.length) {
    restoreHistoryStart();
    alert('Could not convert the selection to editable curves.');
    return;
  }

  function makeTargets(raw) {
    const targets = [];

    for (const n of raw) {
      try {
        const curvesInterface = n.curvesInterface;
        const polyCurve = n.polyCurve || curvesInterface.polyCurve;

        if (curvesInterface && polyCurve) {
          targets.push({
            curvesInterface,
            sourcePolyCurve: polyCurve.clone()
          });
        }
      } catch (e) {
        // Ignore non-vector children inside selected groups.
      }
    }

    return targets;
  }

  function ensureMutableCurveNodes(raw) {
    const result = [];
    const needsConvert = [];

    for (const n of raw) {
      if (isMutableCurveNode(n)) {
        pushUnique(result, n);
        continue;
      }

      pushUnique(needsConvert, n);
    }

    for (const converted of convertNodesToCurves(needsConvert)) {
      if (isMutableCurveNode(converted)) {
        pushUnique(result, converted);
      }
    }

    return result;
  }

  function isMutableCurveNode(n) {
    if (!n) return false;

    try {
      return !!(n.curvesInterface && n.curvesInterface.isMutable && (n.polyCurve || n.curvesInterface.polyCurve));
    } catch (e) {
      return false;
    }
  }

  function convertNodesToCurves(nodesToConvert) {
    const converted = [];

    if (!nodesToConvert.length) return converted;

    try {
      const cmd = DocumentCommand.createConvertToCurves(Selection.create(doc, nodesToConvert, true));
      doc.executeCommand(cmd);

      for (const newNode of collectVectorNodes(cmd.newNodes)) {
        pushUnique(converted, newNode);
      }
    } catch (e) {
      console.log('Zig Zag convert failed: ' + e);
    }

    if (!converted.length) {
      try {
        for (const selected of collectVectorNodes(doc.selection.nodes.toArray())) {
          pushUnique(converted, selected);
        }
      } catch (e) {
        console.log('Zig Zag convert fallback failed: ' + e);
      }
    }

    return converted;
  }

  function restoreHistoryStart() {
    if (doc.history.position !== historyStart) {
      doc.history.position = historyStart;
    }
  }

  function evalBez(b, t) {
    const u = 1 - t;
    return {
      x: u * u * u * b.start.x + 3 * u * u * t * b.c1.x + 3 * u * t * t * b.c2.x + t * t * t * b.end.x,
      y: u * u * u * b.start.y + 3 * u * u * t * b.c1.y + 3 * u * t * t * b.c2.y + t * t * t * b.end.y
    };
  }

  function tanNorm(b, t) {
    const u = 1 - t;
    const dx = 3 * (u * u * (b.c1.x - b.start.x) + 2 * u * t * (b.c2.x - b.c1.x) + t * t * (b.end.x - b.c2.x));
    const dy = 3 * (u * u * (b.c1.y - b.start.y) + 2 * u * t * (b.c2.y - b.c1.y) + t * t * (b.end.y - b.c2.y));
    const l = Math.hypot(dx, dy) || 1e-9;
    return { tx: dx / l, ty: dy / l, nx: -dy / l, ny: dx / l };
  }

  function buildArcTable(beziers) {
    const tbl = [];
    let cum = 0;

    for (let bi = 0; bi < beziers.length; bi++) {
      const b = beziers[bi];
      let prev = evalBez(b, 0);

      if (bi === 0) tbl.push({ bi, t: 0, cum: 0 });

      for (let s = 1; s <= 300; s++) {
        const t = s / 300;
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
    const bi = f < 0.5 ? a.bi : b.bi;
    const t = a.t + (b.t - a.t) * f;

    return { p: evalBez(beziers[bi], t), g: tanNorm(beziers[bi], t) };
  }

  function buildZigZagPolyCurve(sourcePolyCurve, amp, ridges, smooth) {
    const out = PolyCurve.create();

    for (const curve of sourcePolyCurve) {
      const beziers = [...curve.beziers];
      if (!beziers.length) continue;

      const tbl = buildArcTable(beziers);
      const totalLen = tbl[tbl.length - 1].cum;
      if (totalLen < 1e-9) {
        out.addCurve(curve.clone());
        continue;
      }

      const peaks = ridges * 2;
      const step = totalLen / peaks;
      const closed = curve.isClosed;
      const pts = [];

      if (closed) {
        for (let i = 0; i < peaks; i++) {
          const { p, g } = sampleAt(tbl, beziers, i * step);
          const sign = i % 2 === 0 ? 1 : -1;
          pts.push({ x: p.x + g.nx * amp * sign, y: p.y + g.ny * amp * sign, tx: g.tx, ty: g.ty });
        }
      } else {
        for (let i = 0; i <= peaks; i++) {
          const { p, g } = sampleAt(tbl, beziers, Math.min(i * step, totalLen));
          const sign = (i === 0 || i === peaks) ? 0 : (i % 2 === 1 ? 1 : -1);
          pts.push({ x: p.x + g.nx * amp * sign, y: p.y + g.ny * amp * sign, tx: g.tx, ty: g.ty });
        }
      }

      const builder = CurveBuilder.create();
      builder.beginXY(pts[0].x, pts[0].y);

      const count = closed ? peaks : pts.length - 1;
      if (smooth) {
        for (let i = 0; i < count; i++) {
          const p0 = pts[i];
          const p1 = pts[(i + 1) % pts.length];
          const h = Math.hypot(p1.x - p0.x, p1.y - p0.y) / 3;
          builder.addBezierXY(p0.x + p0.tx * h, p0.y + p0.ty * h, p1.x - p1.tx * h, p1.y - p1.ty * h, p1.x, p1.y);
        }
      } else {
        for (let i = 1; i <= count; i++) {
          const pt = pts[i % pts.length];
          builder.lineToXY(pt.x, pt.y);
        }
      }

      if (closed) builder.close();
      out.addCurve(builder.createCurve());
    }

    return out;
  }

  function createZigZagCommand(targets, amp, ridges, smooth) {
    const cb = CompoundCommandBuilder.create();
    let count = 0;

    for (const target of targets) {
      cb.addCommand(DocumentCommand.createSetCurves(
        target.curvesInterface,
        buildZigZagPolyCurve(target.sourcePolyCurve, amp, ridges, smooth)
      ));
      count++;
    }

    return count ? cb.createCommand() : null;
  }

  function readValues() {
    return {
      amp: Math.max(1, Math.round(ampEd.value)),
      ridges: Math.max(1, Math.round(frqEd.value)),
      smooth: smSw.value
    };
  }

  let inPreview = false;
  const previewTargets = makeTargets(nodes);

  function applyPreview() {
    if (inPreview) return;
    inPreview = true;

    try {
      const values = readValues();
      doc.executeCommand(DocumentCommand.createClearPreviews());
      if (previewTargets.length) {
        const cmd = createZigZagCommand(previewTargets, values.amp, values.ridges, values.smooth);
        if (cmd) doc.executeCommand(cmd, true);
      }
    } catch (e) {
      console.log('Zig Zag preview failed: ' + e);
    } finally {
      inPreview = false;
    }
  }

  const dlg = Dialog.create('Zig Zag Effect');
  dlg.initialWidth = 340;

  const col = dlg.addColumn();
  const grp = col.addGroup('Parameters');

  var ampEd = grp.addUnitValueEditor('Amplitude (px)', 'px', 'px', 10, 1, 500);
  ampEd.precision = 0;
  ampEd.showPopupSlider = true;

  var frqEd = grp.addUnitValueEditor('Ridges', 'px', 'px', 8, 1, 500);
  frqEd.precision = 0;
  frqEd.showPopupSlider = true;

  var smSw = grp.addSwitch('Smooth wave', false);

  ampEd.onValueChangedHandler = applyPreview;
  frqEd.onValueChangedHandler = applyPreview;
  smSw.onValueChangedHandler = applyPreview;
  dlg.onControlValueChangedHandler = applyPreview;

  applyPreview();

  const result = dlg.show();
  const finalValues = readValues();

  try {
    doc.executeCommand(DocumentCommand.createClearPreviews());
  } catch (e) {
    console.log('Zig Zag clear preview failed: ' + e);
  }

  if (result.value === DialogResult.Ok.value) {
    const targets = makeTargets(nodes);
    if (targets.length) {
      const cmd = createZigZagCommand(targets, finalValues.amp, finalValues.ridges, finalValues.smooth);
      if (cmd) doc.executeCommand(cmd);
    }
  } else {
    restoreHistoryStart();
  }
}
