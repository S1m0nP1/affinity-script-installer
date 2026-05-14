// @title Kaleidoscope
// @description Adjust symmetry, mirror, radius and offset. A live preview group is created immediately on dialog open and updated whenever any control changes.
// @author S1m0nP1
// @version 1.0.0
// @affinity 3.2+
// @verified true
// @homepage 
// @github 
// @tags vector, design, illustration
// @image images/k.png


"use strict";

/*
Affinity Radial Kaleidoscope v4
- Select one or more vector objects.
- Run the script.
- Adjust symmetry, mirror, radius and offset.
- A live preview group is created immediately on dialog open and updated
  whenever any control changes.
- Cancel deletes the preview group and restores the original selection.
- OK keeps the preview group as the final result (applying hide-source if set).

Notes:
- Uses real (non-preview-flag) node creation for the live preview because
  DocumentCommand.createTransform with duplicateNodes:true creates new nodes,
  and the SDK preview flag only works for mutations of existing nodes.
- Each preview update deletes the previous preview group and rebuilds it.
- This intentionally duplicates whole selected nodes to preserve existing
  fills, strokes, gradients and effects.
*/

const { Document } = require("/document");
const { Dialog, DialogResult } = require("/dialog");
const { AddChildNodesCommandBuilder, DocumentCommand, NodeChildType, NodeMoveType } = require("/commands");
const { ContainerNodeDefinition } = require("/nodes");
const { Selection } = require("/selections");
const { Transform } = require("/geometry");
const { UnitType } = require("/units");
const { setImmediate } = require("/timers");

function exec(doc, cmd) {
  return doc.executeCommand(cmd, false);
}

function alertDialog(title, message) {
  const d = Dialog.create(title);
  d.initialWidth = 420;
  const g = d.addColumn().addGroup("");
  const s = g.addStaticText("", message);
  s.isFullWidth = true;
  d.runModal();
}

function rectToPlain(r) {
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function getNodeBox(n) {
  try { if (n.exactSpreadBaseBox) return n.exactSpreadBaseBox; } catch (e) {}
  try { if (typeof n.getSpreadBaseBox === "function") return n.getSpreadBaseBox(true); } catch (e) {}
  try { if (n.spreadVisibleBox) return n.spreadVisibleBox; } catch (e) {}
  return null;
}

function unionPlainRects(a, b) {
  if (!a) return b;
  if (!b) return a;
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width, b.x + b.width);
  const y2 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function getSelectionBox(nodes) {
  let u = null;
  for (const n of nodes) {
    const b = getNodeBox(n);
    if (b) u = unionPlainRects(u, rectToPlain(b));
  }
  return u;
}

function centerOfRect(r) {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

function getSpreadBox(doc) {
  const spread = doc.currentSpread;
  try {
    return rectToPlain(spread.getSpreadExtents({ includeSpread: true }));
  } catch (e) {
    return { x: 0, y: 0, width: 1000, height: 1000 };
  }
}

function getCentre(doc) {
  return centerOfRect(getSpreadBox(doc));
}

function getRadiusSetup(doc, nodes) {
  const centre = getCentre(doc);
  const spreadBox = getSpreadBox(doc);
  const selectionBox = getSelectionBox(nodes) || spreadBox;
  const selCentre = centerOfRect(selectionBox);
  let dx = selCentre.x - centre.x;
  let dy = selCentre.y - centre.y;
  let dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.001) {
    dx = 0;
    dy = -1;
    dist = 0;
  }

  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return {
    defaultRadius: dist,
    dirX: dx / len,
    dirY: dy / len,
    maxRadius: Math.max(spreadBox.width, spreadBox.height, dist * 2, 100)
  };
}

function makeTransformFromParts(cx, cy, rotateRad, mirrorY, preDx, preDy) {
  let xf = Transform.createTranslate(preDx || 0, preDy || 0);
  xf = Transform.createTranslate(-cx, -cy).multiply(xf);
  if (mirrorY) xf = Transform.createScale(1, -1).multiply(xf);
  xf = Transform.createRotate(rotateRad).multiply(xf);
  xf = Transform.createTranslate(cx, cy).multiply(xf);
  return xf;
}

function createGroup(doc, name) {
  const b = AddChildNodesCommandBuilder.create();
  b.setInsertionTarget(doc.currentSpread);
  b.addContainerNode(ContainerNodeDefinition.create(name));
  const cmd = b.createCommand(false, NodeChildType.Main);
  exec(doc, cmd);
  return cmd.newNodes && cmd.newNodes.length ? cmd.newNodes[0] : null;
}

function deleteGroup(doc, groupNode) {
  if (!groupNode) return;
  try {
    exec(doc, DocumentCommand.createDeleteSelection(
      Selection.create(doc, [groupNode], true)
    ));
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

function hideSourceSafe(doc, sourceNodes) {
  try {
    exec(doc, DocumentCommand.createHideSelection(Selection.create(doc, sourceNodes, true)));
  } catch (e) {}
}

function restoreSourceSelection(doc, sourceNodes) {
  try {
    exec(doc, DocumentCommand.createSetSelection(Selection.create(doc, sourceNodes, true)));
  } catch (e) {}
}

function buildKaleidoscope(doc, sourceNodes, opts) {
  const center = getCentre(doc);
  const symmetry = Math.max(1, Math.round(opts.symmetry));
  const step = (Math.PI * 2) / symmetry;
  const offset = (opts.angleOffset || 0) * Math.PI / 180;

  const sourceBox = getSelectionBox(sourceNodes) || getSpreadBox(doc);
  const sourceCentre = centerOfRect(sourceBox);
  const targetBaseX = center.x + opts.baseDirX * opts.radius;
  const targetBaseY = center.y + opts.baseDirY * opts.radius;
  const preDx = targetBaseX - sourceCentre.x;
  const preDy = targetBaseY - sourceCentre.y;

  const group = createGroup(doc, "Kaleidoscope Preview");
  if (!group) throw new Error("Could not create kaleidoscope group.");

  let totalCopies = 0;

  for (let i = 0; i < symmetry; i++) {
    const a = offset + i * step;

    if (opts.includeSourceSector || i !== 0) {
      const newNodes = duplicateTransformed(doc, sourceNodes,
        makeTransformFromParts(center.x, center.y, a, false, preDx, preDy));
      moveInto(doc, newNodes, group);
      totalCopies += newNodes.length;
    }

    if (opts.mirror) {
      const newNodes = duplicateTransformed(doc, sourceNodes,
        makeTransformFromParts(center.x, center.y, a, true, preDx, preDy));
      moveInto(doc, newNodes, group);
      totalCopies += newNodes.length;
    }
  }

  return { group, copies: totalCopies, sectors: symmetry, center, radius: opts.radius };
}

function main() {
  const doc = Document.current;
  if (!doc) {
    alertDialog("Radial Kaleidoscope", "No document is open.");
    return;
  }

  const sourceNodes = (doc.selection && doc.selection.nodes) ? doc.selection.nodes : [];
  if (!sourceNodes || sourceNodes.length === 0) {
    alertDialog("Radial Kaleidoscope",
      "Select one or more vector objects first, then run the script.");
    return;
  }

  const radiusSetup = getRadiusSetup(doc, sourceNodes);

  const dlg = Dialog.create("Radial Kaleidoscope v4");
  dlg.initialWidth = 430;
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

  const symGrp = col.addGroup("Symmetry");
  note(symGrp, "Creates rotated copies of the current selection around the page centre.");
  const symmetryCtrl = slider(symGrp, "Sectors", 6, 2, 48, 0, "Number of radial symmetry sectors.");
  const mirrorCtrl = symGrp.addCheckBox("Mirror each sector", true);
  mirrorCtrl.description = "Adds a reflected copy in every sector.";
  const includeSourceCtrl = symGrp.addCheckBox("Include original sector copy", true);
  includeSourceCtrl.description = "Adds a duplicated copy at the source position.";
  const offsetCtrl = slider(symGrp, "Angle Offset (°)", 0, -180, 180, 1, "Rotates the whole kaleidoscope.");

  const radiusGrp = col.addGroup("Radius");
  note(radiusGrp, "Radius moves the source motif towards or away from the page centre.");
  const radiusCtrl = slider(radiusGrp, "Radius",
    radiusSetup.defaultRadius, 0, radiusSetup.maxRadius, 1,
    "Distance from page centre to the source motif's duplicated centre.");

  const outGrp = col.addGroup("Output");
  note(outGrp, "Preview updates live. OK keeps the result; Cancel removes it.");
  const hideSourceCtrl = outGrp.addCheckBox("Hide source on Apply", false);
  hideSourceCtrl.description = "Hides the selected source objects when OK is clicked.";

  const actGrp = col.addGroup("");
  const statusTxt = actGrp.addStaticText("", "");
  statusTxt.isFullWidth = true;

  function getOpts() {
    return {
      symmetry: Math.round(symmetryCtrl.value),
      mirror: !!mirrorCtrl.value,
      includeSourceSector: !!includeSourceCtrl.value,
      angleOffset: offsetCtrl.value,
      radius: radiusCtrl.value,
      baseDirX: radiusSetup.dirX,
      baseDirY: radiusSetup.dirY,
      hideSourceOnApply: !!hideSourceCtrl.value
    };
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
      clearPreviewGroup();
      const res = buildKaleidoscope(doc, sourceNodes, getOpts());
      previewGroup = res.group;
      // Restore source selection so the user can see what's selected
      restoreSourceSelection(doc, sourceNodes);
      statusTxt.text =
        (initial ? "Preview" : "Preview") +
        `: ${res.sectors} sectors, ${res.copies} node(s), ` +
        `centre ${res.center.x.toFixed(1)},${res.center.y.toFixed(1)}, ` +
        `radius ${res.radius.toFixed(1)}`;
    } catch (e) {
      statusTxt.text = "Preview error: " + (e && e.message ? e.message : e);
      console.log("Radial Kaleidoscope preview error: " + (e && e.stack ? e.stack : e));
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

  for (const ctrl of [symmetryCtrl, mirrorCtrl, includeSourceCtrl, offsetCtrl, radiusCtrl, hideSourceCtrl]) {
    ctrl.onValueChangedHandler = updatePreview;
  }

  // Defer initial preview until after runModal() opens the dialog
  statusTxt.text = "Opening preview…";
  setImmediate(() => showPreview(true));

  const result = dlg.runModal();

  if (result.value === DialogResult.Ok.value) {
    try {
      if (!previewGroup) {
        // Shouldn't happen, but build fresh if preview was never created
        const res = buildKaleidoscope(doc, sourceNodes, getOpts());
        previewGroup = res.group;
      }
      // Rename to final name
      exec(doc, DocumentCommand.createSetDescription(
        Selection.create(doc, [previewGroup], true), "Radial Kaleidoscope"));
      if (getOpts().hideSourceOnApply) {
        hideSourceSafe(doc, sourceNodes);
      }
      exec(doc, DocumentCommand.createSetSelection(
        Selection.create(doc, [previewGroup], true)));
    } catch (e) {
      alertDialog("Radial Kaleidoscope – Apply error",
        String(e && e.stack ? e.stack : e));
    }
  } else {
    // Cancel – remove the preview group and restore original selection
    clearPreviewGroup();
    restoreSourceSelection(doc, sourceNodes);
  }
}

try {
  main();
} catch (err) {
  alertDialog("Radial Kaleidoscope – Crash",
    String(err && err.stack ? err.stack : err));
}
