// @title Product Dimension Annotator
// @description Select one or more objects, run the script, choose width/height/both, and it creates grouped dimension annotations.
// @author S1m0nP1
// @version 1.0.0
// @affinity 3.2+
// @verified true
// @homepage https://affinityhub.js.org/
// @github https://github.com/S1m0nP1/affinity-script-installer
// @tags vector, design, utility
// @image images/dimension.png


const { Document } = require('/document.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { Curve, PolyCurve } = require('/geometry.js');
const { UnitType, UnitValueConverter } = require('/units.js');
const { RGB8 } = require('/colours.js');
const { FillDescriptor } = require('/fills.js');
const { ArrowHead, ArrowHeadStyle, LineStyle, LineStyleDescriptor, LineCap, LineJoin } = require('/linestyle.js');
const { StoryBuilder } = require('/storybuilder.js');
const { GlyphAttDoubleType } = require('/glyphatts.js');
const { AddChildNodesCommandBuilder } = require('/commands.js');
const { ArtTextNodeDefinition, ContainerNodeDefinition, PolyCurveNodeDefinition } = require('/nodes.js');

const doc = Document.current;
if (!doc) {
    console.log('Open a document and select the object you want to dimension.');
    return;
}

const sel = doc.selection;
if (!sel || sel.length === 0) {
    console.log('Select one or more objects first.');
    return;
}

function unionRects(a, b) {
    const x1 = Math.min(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x + a.width, b.x + b.width);
    const y2 = Math.max(a.y + a.height, b.y + b.height);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

let box = null;
for (let i = 0; i < sel.length; i++) {
    const node = sel.at(i).node;
    const b = node.getExactSpreadBaseBox ? node.getExactSpreadBaseBox() : node.getSpreadBaseBox(true);
    if (b) box = box ? unionRects(box, b) : b;
}

if (!box || box.width <= 0 || box.height <= 0) {
    console.log('Could not find a measurable bounding box for the selection.');
    return;
}

const dlg = Dialog.create('Product Dimension Annotator');
dlg.initialWidth = 360;
const col = dlg.addColumn();
const g = col.addGroup('Dimension Settings');
const dimensionCtrl = g.addComboBox('Create', ['Width', 'Height', 'Width and height'], 2);
const endCtrl = g.addComboBox('Ends', ['T-bars', 'Arrowheads'], 0);
const unitCtrl = g.addComboBox('Units', ['mm', 'cm', 'in', 'px'], 0);
const precisionCtrl = g.addTextBox('Decimals', '1');
const offsetCtrl = g.addTextBox('Offset', '12');
const extCtrl = g.addTextBox('Extension past line', '3');
const fontCtrl = g.addTextBox('Label size pt', '9');
const strokeCtrl = g.addTextBox('Stroke pt', '0.75');
g.addStaticText('', 'Offset and extension are interpreted in the output unit.');

const result = dlg.runModal();
if (result.value !== DialogResult.Ok.value) return;

const unitChoices = [UnitType.Millimetre, UnitType.Centimetre, UnitType.Inch, UnitType.Pixel];
const unitNames = ['mm', 'cm', 'in', 'px'];
const outUnit = unitChoices[unitCtrl.selectedIndex] || UnitType.Millimetre;
const outUnitName = unitNames[unitCtrl.selectedIndex] || 'mm';
const converter = doc.unitValueConverter || UnitValueConverter.create(doc.dpi, doc.viewdpi);

function num(text, fallback, min) {
    const v = parseFloat(String(text).replace(',', '.'));
    if (!isFinite(v)) return fallback;
    return min == null ? v : Math.max(min, v);
}

const precision = Math.max(0, Math.min(4, Math.round(num(precisionCtrl.text, 1, 0))));
const offsetPx = num(offsetCtrl.text, 12, 0) * converter.getConversionFactor(outUnit, UnitType.Pixel);
const extensionPastPx = num(extCtrl.text, 3, 0) * converter.getConversionFactor(outUnit, UnitType.Pixel);
const fontPx = num(fontCtrl.text, 9, 1) * converter.getConversionFactor(UnitType.Point, UnitType.Pixel);
const strokePx = num(strokeCtrl.text, 0.75, 0.1) * converter.getConversionFactor(UnitType.Point, UnitType.Pixel);
const capSizePx = Math.max(6, fontPx * 0.75);
const gapPx = Math.max(3, fontPx * 0.35);
const lineColour = RGB8(0, 0, 0);
const noFill = FillDescriptor.createNone();
const penFill = FillDescriptor.createSolid(lineColour);

function makeLineStyle(withArrows) {
    const style = LineStyle.createDefaultWithWeight(strokePx);
    style.cap = LineCap.Butt;
    style.join = LineJoin.Miter;
    let desc = LineStyleDescriptor.createDefault(strokePx).cloneWithNewLineStyle(style);
    if (withArrows) {
        const arrow = ArrowHead.create(ArrowHeadStyle.SimpleTall, { scaleX: 2.0, scaleY: 2.0, solidLine: true });
        desc = desc.cloneWithNewArrowHeads(arrow, arrow);
    }
    return desc;
}

const plainStyle = makeLineStyle(false);
const arrowStyle = makeLineStyle(true);

function polyLineDef(x1, y1, x2, y2, style) {
    const pc = PolyCurve.create();
    pc.addCurve(Curve.createLineXY(x1, y1, x2, y2));
    return PolyCurveNodeDefinition.create(pc, noFill, style, penFill, noFill);
}

function textDef(text, x, y) {
    const sb = StoryBuilder.create();
    sb.setToArtisticTextDefaultStyle(doc.dpi, doc.format);
    const glyphs = sb.glyphAtts;
    glyphs.setDoubleValue(GlyphAttDoubleType.Height, fontPx);
    glyphs.brushFill = penFill;
    sb.setGlyphAtts(glyphs);
    sb.addText(text);
    return ArtTextNodeDefinition.createFromStoryBuilder({ x: x, y: y }, sb);
}

function fmt(px) {
    const value = px * converter.getConversionFactor(UnitType.Pixel, outUnit);
    return value.toFixed(precision) + ' ' + outUnitName;
}

function approxLabelX(text, centreX) {
    return centreX - Math.min(text.length * fontPx * 0.28, 220);
}

const makeArrows = endCtrl.selectedIndex === 1;
const annotations = [];

function addHorizontalDimension() {
    const y = box.y - offsetPx;
    const x1 = box.x;
    const x2 = box.x + box.width;
    const label = fmt(box.width);
    annotations.push(polyLineDef(x1, y, x2, y, makeArrows ? arrowStyle : plainStyle));
    annotations.push(polyLineDef(x1, box.y, x1, y - extensionPastPx, plainStyle));
    annotations.push(polyLineDef(x2, box.y, x2, y - extensionPastPx, plainStyle));
    if (!makeArrows) {
        annotations.push(polyLineDef(x1, y - capSizePx / 2, x1, y + capSizePx / 2, plainStyle));
        annotations.push(polyLineDef(x2, y - capSizePx / 2, x2, y + capSizePx / 2, plainStyle));
    }
    annotations.push(textDef(label, approxLabelX(label, (x1 + x2) / 2), y - gapPx));
}

function addVerticalDimension() {
    const x = box.x + box.width + offsetPx;
    const y1 = box.y;
    const y2 = box.y + box.height;
    const label = fmt(box.height);
    annotations.push(polyLineDef(x, y1, x, y2, makeArrows ? arrowStyle : plainStyle));
    annotations.push(polyLineDef(box.x + box.width, y1, x + extensionPastPx, y1, plainStyle));
    annotations.push(polyLineDef(box.x + box.width, y2, x + extensionPastPx, y2, plainStyle));
    if (!makeArrows) {
        annotations.push(polyLineDef(x - capSizePx / 2, y1, x + capSizePx / 2, y1, plainStyle));
        annotations.push(polyLineDef(x - capSizePx / 2, y2, x + capSizePx / 2, y2, plainStyle));
    }
    annotations.push(textDef(label, x + gapPx, (y1 + y2) / 2 + fontPx * 0.35));
}

if (dimensionCtrl.selectedIndex === 0 || dimensionCtrl.selectedIndex === 2) addHorizontalDimension();
if (dimensionCtrl.selectedIndex === 1 || dimensionCtrl.selectedIndex === 2) addVerticalDimension();

const containerBuilder = AddChildNodesCommandBuilder.create();
containerBuilder.addContainerNode(ContainerNodeDefinition.create('Production dimensions'));
const containerCmd = containerBuilder.createCommand(false);
doc.executeCommand(containerCmd);
const container = containerCmd.newNodes[0];

const builder = AddChildNodesCommandBuilder.create();
builder.setInsertionTarget(container);
for (const def of annotations) builder.addNode(def);
const cmd = builder.createCommand(true);
doc.executeCommand(cmd);

console.log('Created ' + annotations.length + ' dimension annotation objects in a group named Production dimensions.');
