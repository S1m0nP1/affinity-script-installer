// @title ChartsPro
// @description Create charts from CSV files
// @author S1m0nP1 based on a script by OurielMak
// @version 1.0.0
// @affinity 3.2+
// @verified true
// @homepage https://s1m0np1.github.io/affinity-script-installer/
// @github https://github.com/S1m0nP1/affinity-script-installer
// @tags utility
// @image images/ChartsPro.png

"use strict";

const { app } = require("/application");
const { Dialog, DialogResult } = require("/dialog");
const { Document } = require("/document");
const { UnitType } = require("/units");
const { Colour } = require("/colours");
const { FillDescriptor, SolidFill } = require("/fills");
const {
  ArtTextNodeDefinition,
  ContainerNodeDefinition,
  ShapeNodeDefinition,
} = require("/nodes");
const { Shape, ShapeType } = require("/shapes");
const { Rectangle } = require("/geometry");
const { BlendMode } = require("affinity:common");
const { StoryBuilder } = require("/storybuilder");
const { StoryDelta } = require("/storydelta");
const { GlyphAttDoubleType } = require("/glyphatts");
const {
  AddChildNodesCommandBuilder,
  DocumentCommand,
  NodeChildType,
} = require("/commands");
const { Selection } = require("/selections");
const { Directory, File } = require("/fs");
const { Buffer } = require("/buffer");

function exec(doc, cmd, preview) {
  return doc.executeCommand(cmd, !!preview);
}

function clearDocumentPreviews(doc) {
  try {
    if (typeof doc.clearPreviews === "function") doc.clearPreviews();
    else exec(doc, DocumentCommand.createClearPreviews(), false);
  } catch (e) {
    try {
      exec(doc, DocumentCommand.createClearPreviews(), false);
    } catch (_e) {}
  }
}

function deleteNodeSafe(doc, node) {
  if (!doc || !node) return;

  try {
    const selection = Selection.create(doc, [node]);
    exec(doc, DocumentCommand.createDeleteSelection(selection, false), false);
  } catch (e) {
    try {
      doc.deleteSelection(Selection.create(doc, [node]), false);
    } catch (_e) {}
  }
}

let DRAW_OFFSET_X = 0;
let DRAW_OFFSET_Y = 0;

function rectToPlain(rect) {
  if (!rect) return { x: 0, y: 0, width: 0, height: 0 };

  const x = typeof rect.x === "number" ? rect.x : rect.left || 0;
  const y = typeof rect.y === "number" ? rect.y : rect.top || 0;
  const width =
    typeof rect.width === "number" ? rect.width : (rect.right || x) - x;
  const height =
    typeof rect.height === "number" ? rect.height : (rect.bottom || y) - y;

  return { x, y, width, height };
}

function getCenteredDrawOffset(doc, width, height) {
  let area = null;

  try {
    area = rectToPlain(doc.currentSpread.getSpreadExtents({ includeSpread: true }));
  } catch (e) {
    area = { x: 0, y: 0, width, height };
  }

  return {
    x: area.x + (area.width - width) / 2,
    y: area.y + (area.height - height) / 2,
  };
}

// ============================================================
// PROFESSIONAL COLOR PALETTES
// ============================================================

const COLOR_PALETTES = {
  // Original Chart.js palette
  CHART_JS: {
    name: "Chart.js Original",
    colors: [
      { r: 255, g: 99, b: 132, alpha: 255 }, // Red
      { r: 54, g: 162, b: 235, alpha: 255 }, // Blue
      { r: 255, g: 206, b: 86, alpha: 255 }, // Yellow
      { r: 75, g: 192, b: 192, alpha: 255 }, // Turquoise
      { r: 153, g: 102, b: 255, alpha: 255 }, // Purple
      { r: 255, g: 159, b: 64, alpha: 255 }, // Orange
      { r: 255, g: 99, b: 255, alpha: 255 }, // Pink
      { r: 99, g: 255, b: 132, alpha: 255 }, // Green
    ],
  },
  // Corporate Palette (BUSCOLOG)
  CORPORATE: {
    name: "BUSCOLOG Corporate",
    colors: [
      { r: 18, g: 48, b: 136, alpha: 255 }, // Navy blue
      { r: 255, g: 223, b: 5, alpha: 255 }, // Yellow
      { r: 0, g: 112, b: 192, alpha: 255 }, // Sky blue
      { r: 255, g: 128, b: 0, alpha: 255 }, // Orange
      { r: 112, g: 48, b: 160, alpha: 255 }, // Purple
      { r: 0, g: 176, b: 80, alpha: 255 }, // Green
    ],
  },
  // Soft Pastel palette
  PASTEL: {
    name: "Soft Pastel",
    colors: [
      { r: 255, g: 179, b: 186, alpha: 255 }, // Pink
      { r: 255, g: 223, b: 186, alpha: 255 }, // Peach
      { r: 255, g: 255, b: 186, alpha: 255 }, // Yellow
      { r: 186, g: 255, b: 201, alpha: 255 }, // Green
      { r: 186, g: 225, b: 255, alpha: 255 }, // Blue
      { r: 216, g: 191, b: 255, alpha: 255 }, // Lavender
      { r: 255, g: 191, b: 216, alpha: 255 }, // Light pink
    ],
  },
  // Vibrant palette
  VIBRANT: {
    name: "Vibrant",
    colors: [
      { r: 255, g: 59, b: 48, alpha: 255 }, // Bright red
      { r: 255, g: 149, b: 0, alpha: 255 }, // Orange
      { r: 255, g: 204, b: 0, alpha: 255 }, // Yellow
      { r: 52, g: 199, b: 89, alpha: 255 }, // Green
      { r: 0, g: 122, b: 255, alpha: 255 }, // Blue
      { r: 88, g: 86, b: 214, alpha: 255 }, // Indigo
      { r: 175, g: 82, b: 222, alpha: 255 }, // Purple
    ],
  },
  // Monochrome palette
  MONOCHROME: {
    name: "Monochrome",
    colors: [
      { r: 30, g: 30, b: 30, alpha: 255 },
      { r: 70, g: 70, b: 70, alpha: 255 },
      { r: 110, g: 110, b: 110, alpha: 255 },
      { r: 150, g: 150, b: 150, alpha: 255 },
      { r: 190, g: 190, b: 190, alpha: 255 },
      { r: 230, g: 230, b: 230, alpha: 255 },
    ],
  },
  // Ocean palette
  OCEAN: {
    name: "Ocean",
    colors: [
      { r: 0, g: 119, b: 190, alpha: 255 }, // Deep blue
      { r: 0, g: 180, b: 216, alpha: 255 }, // Cyan
      { r: 72, g: 202, b: 228, alpha: 255 }, // Light blue
      { r: 144, g: 224, b: 239, alpha: 255 }, // Turquoise
      { r: 0, g: 150, b: 136, alpha: 255 }, // Ocean green
      { r: 0, g: 200, b: 83, alpha: 255 }, // Green
    ],
  },
  // Sunset palette
  SUNSET: {
    name: "Sunset",
    colors: [
      { r: 255, g: 94, b: 77, alpha: 255 }, // Coral
      { r: 255, g: 154, b: 0, alpha: 255 }, // Orange
      { r: 255, g: 207, b: 64, alpha: 255 }, // Yellow
      { r: 255, g: 99, b: 132, alpha: 255 }, // Pink
      { r: 218, g: 112, b: 214, alpha: 255 }, // Orchid
      { r: 147, g: 112, b: 219, alpha: 255 }, // Purple
    ],
  },
};

// ============================================================
// CHART TYPES
// ============================================================

const CHART_TYPES = {
  PIE: { id: "pie", name: "Pie Chart", icon: "🥧" },
  DOUGHNUT: { id: "doughnut", name: "Doughnut Chart", icon: "🍩" },
  BAR: { id: "bar", name: "Vertical Bar Chart", icon: "📊" },
  BAR_HORIZONTAL: {
    id: "barHorizontal",
    name: "Horizontal Bar Chart",
    icon: "📈",
  },
  LINE: { id: "line", name: "Line Chart", icon: "📉" },
  RADAR: { id: "radar", name: "Radar Chart", icon: "🕸️" },
};

// ============================================================
// FORMATTING OPTIONS
// ============================================================

const FORMAT_OPTIONS = {
  PERCENTAGE: "percentage",
  VALUE: "value",
  BOTH: "both",
};

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function mkColour(rgba) {
  if (!rgba) return Colour.createDefault();
  return Colour.createRGBA8({
    r: rgba.r,
    g: rgba.g,
    b: rgba.b,
    alpha: rgba.alpha,
  });
}

function mkFill(rgba) {
  if (!rgba) return FillDescriptor.createNone();
  const solidFill = SolidFill.create(mkColour(rgba));
  return FillDescriptor.createSolid(solidFill, BlendMode.Normal);
}

function addRect(builder, x, y, w, h, fillRgba) {
  if (w <= 0 || h <= 0) return;
  const shape = Shape.create(ShapeType.Rectangle);
  const fill = fillRgba ? mkFill(fillRgba) : FillDescriptor.createNone();
  const shapeDef = ShapeNodeDefinition.create(
    shape,
    new Rectangle(x + DRAW_OFFSET_X, y + DRAW_OFFSET_Y, w, h),
    fill,
    null,
    null,
    null,
  );
  builder.addNode(shapeDef);
}

function addEditableText(builder, x, baselineY, text, fontSize = 14) {
  const doc = Document.current;
  const story = StoryBuilder.create();

  try {
    story.setToArtisticTextDefaultStyle(doc?.dpi || 300, doc?.rasterFormat);
  } catch (e) {}

  story.applyGlyphDelta(
    StoryDelta.createGlyphDouble(GlyphAttDoubleType.Height, fontSize),
  );
  story.addText(String(text));
  builder.addNode(
    ArtTextNodeDefinition.createFromStoryBuilder(
      { x: x + DRAW_OFFSET_X, y: baselineY + DRAW_OFFSET_Y },
      story,
    ),
  );
}

function getCenteredTextBaselineY(centerY, fontSize) {
  const capHeight = fontSize * 0.72;
  const descenderDepth = fontSize * 0.22;
  return centerY + (capHeight - descenderDepth) / 2;
}

function addLine(builder, x1, y1, x2, y2, strokeRgba, strokeWidth = 1) {
  // Creating a line via a thin rectangle
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);

  if (length < 0.1) return;

  const angle = Math.atan2(dy, dx);
  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;

  // For horizontal/vertical axes, simplify
  if (Math.abs(angle) < 0.01) {
    addRect(builder, x1, y1 - strokeWidth / 2, length, strokeWidth, strokeRgba);
  } else if (Math.abs(angle - Math.PI / 2) < 0.01) {
    addRect(builder, x1 - strokeWidth / 2, y1, strokeWidth, length, strokeRgba);
  } else {
    // Approximation for diagonal lines
    addRect(
      builder,
      centerX - length / 2,
      centerY - strokeWidth / 2,
      length,
      strokeWidth,
      strokeRgba,
    );
  }
}

// ============================================================
// DRAWING A PIE SLICE
// ============================================================

function drawPieSlice(
  builder,
  centerX,
  centerY,
  radius,
  startDeg,
  endDeg,
  fillRgba,
) {
  if (endDeg <= startDeg) return;

  const startRad = (startDeg * Math.PI) / 180;
  const endRad = (endDeg * Math.PI) / 180;

  try {
    const shape = Shape.create(ShapeType.Pie);
    if (shape) {
      shape.startAngle = startRad;
      shape.endAngle = endRad;
      shape.innerRadius = 0;

      const bounds = {
        x: centerX - radius,
        y: centerY - radius,
        width: radius * 2,
        height: radius * 2,
      };

      const shapeDef = ShapeNodeDefinition.create(
        shape,
        new Rectangle(
          bounds.x + DRAW_OFFSET_X,
          bounds.y + DRAW_OFFSET_Y,
          bounds.width,
          bounds.height,
        ),
        fillRgba ? mkFill(fillRgba) : null,
        null,
        null,
        null,
      );
      builder.addNode(shapeDef);
      return;
    }
  } catch (e) {
    // Fallback: polygon
  }

  // Alternative method with polygons
  const segments = Math.max(12, Math.floor((endDeg - startDeg) / 3));
  const points = [{ x: centerX, y: centerY }];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angleDeg = startDeg + (endDeg - startDeg) * t;
    const angleRad = (angleDeg * Math.PI) / 180;
    points.push({
      x: centerX + radius * Math.cos(angleRad),
      y: centerY + radius * Math.sin(angleRad),
    });
  }

  // Creating triangles
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];
    const width = Math.abs(p2.x - p1.x);
    const height = Math.abs(p2.y - p1.y);
    if (width > 0.3 && height > 0.3) {
      addRect(builder, p1.x, p1.y, width, height, fillRgba);
    }
  }
}

// ============================================================
// ADVANCED CHART FUNCTIONS
// ============================================================

function generatePieChart(builder, data, labels, config) {
  const centerX = config.width / 2;
  const centerY = config.height / 2;
  const radius =
    Math.min(config.width, config.height) * (config.radius / 100) * 0.5;

  let total = data.reduce((sum, val) => sum + val, 0);
  let currentAngle = config.startAngle;
  const sectors = [];

  for (let i = 0; i < data.length; i++) {
    const angle = (data[i] / total) * 360;
    const color = config.palette[i % config.palette.length];

    drawPieSlice(
      builder,
      centerX,
      centerY,
      radius,
      currentAngle,
      currentAngle + angle,
      color,
    );

    sectors.push({
      label: labels[i],
      value: data[i],
      percentage: (data[i] / total) * 100,
      startAngle: currentAngle,
      endAngle: currentAngle + angle,
      color: color,
    });

    currentAngle += angle;
  }

  // Doughnut chart
  if (config.chartType === CHART_TYPES.DOUGHNUT.id && config.doughnutHole > 0) {
    const holeRadius = radius * (config.doughnutHole / 100);
    drawPieSlice(
      builder,
      centerX,
      centerY,
      holeRadius,
      0,
      360,
      { r: 255, g: 255, b: 255, alpha: 255 },
    );
  }

  return sectors;
}

function generateBarChart(builder, data, labels, config) {
  const margin = config.margin;
  const chartX = margin.left;
  const chartY = margin.top;
  const chartWidth = config.width - margin.left - margin.right;
  const chartHeight = config.height - margin.top - margin.bottom;

  const maxValue = Math.max(...data, 1);
  const valueRange = maxValue - (config.minValue || 0);

  // Axes
  const axisX = chartX;
  const axisY = chartY + chartHeight;

  addLine(
    builder,
    axisX,
    chartY,
    axisX,
    axisY,
    config.axisColor,
    config.axisWidth,
  );
  addLine(
    builder,
    axisX,
    axisY,
    axisX + chartWidth,
    axisY,
    config.axisColor,
    config.axisWidth,
  );

  // Horizontal grid
  if (config.showGrid) {
    const gridLines = Math.min(10, Math.floor(chartHeight / 30));
    for (let i = 1; i <= gridLines; i++) {
      const y = axisY - (i / gridLines) * chartHeight;
      addLine(
        builder,
        axisX,
        y,
        axisX + chartWidth,
        y,
        config.gridColor,
        config.gridWidth,
      );
    }
  }

  // Bars
  const barCount = data.length;
  const barWidth = (chartWidth / barCount) * config.barWidthRatio;
  const barSpacing = (chartWidth / barCount) * (1 - config.barWidthRatio);

  const bars = [];
  for (let i = 0; i < barCount; i++) {
    const barHeight = (data[i] / maxValue) * chartHeight;
    const barX = axisX + i * (barWidth + barSpacing) + barSpacing / 2;
    const barY = axisY - barHeight;
    const color = config.palette[i % config.palette.length];

    addRect(builder, barX, barY, barWidth, barHeight, color);

    bars.push({
      label: labels[i],
      value: data[i],
      percentage: (data[i] / maxValue) * 100,
      x: barX,
      y: barY,
      width: barWidth,
      height: barHeight,
      color: color,
    });
  }

  return bars;
}

function generateHorizontalBarChart(builder, data, labels, config) {
  const margin = config.margin;
  const chartX = margin.left;
  const chartY = margin.top;
  const chartWidth = config.width - margin.left - margin.right;
  const chartHeight = config.height - margin.top - margin.bottom;

  const maxValue = Math.max(...data, 1);

  // Axes
  const axisX = chartX;
  const axisY = chartY + chartHeight;

  addLine(
    builder,
    axisX,
    chartY,
    axisX,
    axisY,
    config.axisColor,
    config.axisWidth,
  );
  addLine(
    builder,
    axisX,
    axisY,
    axisX + chartWidth,
    axisY,
    config.axisColor,
    config.axisWidth,
  );

  // Horizontal bars
  const barCount = data.length;
  const barHeight = (chartHeight / barCount) * config.barWidthRatio;
  const barSpacing = (chartHeight / barCount) * (1 - config.barWidthRatio);

  const bars = [];
  for (let i = 0; i < barCount; i++) {
    const barWidth = (data[i] / maxValue) * chartWidth;
    const barY = chartY + i * (barHeight + barSpacing) + barSpacing / 2;
    const barX = axisX;
    const color = config.palette[i % config.palette.length];

    addRect(builder, barX, barY, barWidth, barHeight, color);

    bars.push({
      label: labels[i],
      value: data[i],
      percentage: (data[i] / maxValue) * 100,
      x: barX,
      y: barY,
      width: barWidth,
      height: barHeight,
      color: color,
    });
  }

  return bars;
}

function generateLineChart(builder, data, labels, config) {
  const margin = config.margin;
  const chartX = margin.left;
  const chartY = margin.top;
  const chartWidth = config.width - margin.left - margin.right;
  const chartHeight = config.height - margin.top - margin.bottom;

  const maxValue = Math.max(...data, 1);

  // Axes
  const axisX = chartX;
  const axisY = chartY + chartHeight;

  addLine(
    builder,
    axisX,
    chartY,
    axisX,
    axisY,
    config.axisColor,
    config.axisWidth,
  );
  addLine(
    builder,
    axisX,
    axisY,
    axisX + chartWidth,
    axisY,
    config.axisColor,
    config.axisWidth,
  );

  // Points and lines
  const points = [];
  const xStep = chartWidth / (data.length - 1);

  for (let i = 0; i < data.length; i++) {
    const x = axisX + i * xStep;
    const y = axisY - (data[i] / maxValue) * chartHeight;
    points.push({ x, y, value: data[i], label: labels[i] });

    // Point
    if (config.showPoints) {
      const pointSize = config.pointSize;
      addRect(
        builder,
        x - pointSize / 2,
        y - pointSize / 2,
        pointSize,
        pointSize,
        config.lineColor || config.palette[0],
      );
    }
  }

  // Lines between points
  for (let i = 1; i < points.length; i++) {
    addLine(
      builder,
      points[i - 1].x,
      points[i - 1].y,
      points[i].x,
      points[i].y,
      config.lineColor || config.palette[0],
      config.lineWidth,
    );
  }

  return points;
}

function generateRadarChart(builder, data, labels, config) {
  const centerX = config.width / 2;
  const centerY = config.height / 2;
  const maxRadius = Math.min(config.width, config.height) * 0.35;
  const maxValue = Math.max(...data, 1);

  const angles = [];
  const step = (Math.PI * 2) / data.length;

  for (let i = 0; i < data.length; i++) {
    angles.push(-Math.PI / 2 + i * step);
  }

  // Drawing axes
  for (let i = 0; i < data.length; i++) {
    const x = centerX + maxRadius * Math.cos(angles[i]);
    const y = centerY + maxRadius * Math.sin(angles[i]);
    addLine(
      builder,
      centerX,
      centerY,
      x,
      y,
      config.axisColor,
      config.axisWidth,
    );
  }

  // Drawing concentric rings
  const rings = [0.2, 0.4, 0.6, 0.8, 1.0];
  for (const ring of rings) {
    const radius = maxRadius * ring;
    // Circle approximation with rectangles
    for (let i = 0; i < 360; i += 10) {
      const rad = (i * Math.PI) / 180;
      const x = centerX + radius * Math.cos(rad);
      const y = centerY + radius * Math.sin(rad);
      const nextRad = ((i + 10) * Math.PI) / 180;
      const nextX = centerX + radius * Math.cos(nextRad);
      const nextY = centerY + radius * Math.sin(nextRad);
      addLine(builder, x, y, nextX, nextY, config.gridColor, config.gridWidth);
    }
  }

  // Drawing radar area
  const points = [];
  for (let i = 0; i < data.length; i++) {
    const radius = (data[i] / maxValue) * maxRadius;
    const x = centerX + radius * Math.cos(angles[i]);
    const y = centerY + radius * Math.sin(angles[i]);
    points.push({ x, y, value: data[i], label: labels[i] });
  }

  // Connecting lines
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    addLine(
      builder,
      points[i].x,
      points[i].y,
      next.x,
      next.y,
      config.lineColor || config.palette[0],
      config.lineWidth,
    );
  }

  // Points
  if (config.showPoints) {
    for (const point of points) {
      addRect(
        builder,
        point.x - 3,
        point.y - 3,
        6,
        6,
        config.lineColor || config.palette[0],
      );
    }
  }

  return points;
}

// ============================================================
// LEGEND GENERATION
// ============================================================

function generateLegend(builder, items, config) {
  if (!config.showLegend) return;

  const colors = config.palette;
  const itemCount = Math.min(items.length, colors.length);
  const itemHeight = config.legendItemHeight;
  const keySize = 14;
  const gap = 8;

  let columnCount = 1;
  let columnWidth = 210;
  let legendX = config.legendPosition === "left" ? 30 : config.width - 230;
  let legendY = config.legendY;

  if (config.legendPosition === "bottom") {
    columnCount = Math.min(3, Math.max(1, itemCount));
    columnWidth = (config.width - 60) / columnCount;
    const rowCount = Math.ceil(itemCount / columnCount);
    legendX = 30;
    legendY = Math.max(20, config.height - rowCount * itemHeight - 20);
  }

  for (let i = 0; i < itemCount; i++) {
    const col = config.legendPosition === "bottom" ? i % columnCount : 0;
    const row =
      config.legendPosition === "bottom" ? Math.floor(i / columnCount) : i;
    const x = legendX + col * columnWidth;
    const rowY = legendY + row * itemHeight;
    const rowCenterY = rowY + itemHeight / 2;
    const fontSize = 13;
    const color = colors[i % colors.length];

    addRect(
      builder,
      x,
      rowY + (itemHeight - keySize) / 2,
      keySize,
      keySize,
      color,
    );

    let labelText = items[i].label;
    if (
      config.showValues === FORMAT_OPTIONS.PERCENTAGE &&
      items[i].percentage !== undefined
    ) {
      labelText += ` (${items[i].percentage.toFixed(1)}%)`;
    } else if (config.showValues === FORMAT_OPTIONS.VALUE) {
      labelText += ` (${items[i].value})`;
    } else if (
      config.showValues === FORMAT_OPTIONS.BOTH &&
      items[i].percentage !== undefined
    ) {
      labelText += ` (${items[i].value} - ${items[i].percentage.toFixed(1)}%)`;
    }

    addEditableText(
      builder,
      x + keySize + gap,
      getCenteredTextBaselineY(rowCenterY, fontSize),
      labelText,
      fontSize,
    );
  }
}

// ============================================================
// CSV IMPORT FROM DESKTOP
// ============================================================

function cleanFilePath(path) {
  if (path.startsWith("file://")) {
    return decodeURIComponent(path.replace(/^file:\/\//, ""));
  }

  return path;
}

function getFileName(path) {
  return path.split(/[\\/]/).pop();
}

function getDesktopCsvPaths() {
  const desktopPath = app.getUserDesktopPath;

  try {
    return new Directory(desktopPath).entries.filePaths
      .filter((path) => /\.csv$/i.test(path))
      .toArray()
      .sort((a, b) => getFileName(a).localeCompare(getFileName(b)));
  } catch (e) {
    return [];
  }
}

function readTextFile(path) {
  const file = new File(path, "rb");
  try {
    const buffer = Buffer.create(file.length);
    file.read(buffer, buffer.length);
    return buffer.toString();
  } finally {
    file.close();
  }
}

async function importCSVFile() {
  const desktopPath = app.getUserDesktopPath;
  const csvPaths = getDesktopCsvPaths();

  const dlg = Dialog.create("Import CSV File");
  dlg.initialWidth = 560;

  const col = dlg.addColumn();
  const fileGroup = col.addGroup("Desktop CSV Files");

  let csvCtrl = null;
  if (csvPaths.length > 0) {
    csvCtrl = fileGroup.addComboBox(
      "Choose CSV",
      csvPaths.map(getFileName),
    );
    csvCtrl.selectedIndex = 0;
  } else {
    fileGroup.addStaticText(
      "",
      "No CSV files were found on your Desktop. Save or move a CSV there, or enter its Desktop path below.",
    ).isFullWidth = true;
  }

  const manualPathCtrl = fileGroup.addTextBox(
    "Manual path",
    csvPaths[0] || desktopPath + "/data.csv",
  );
  manualPathCtrl.isFullWidth = true;

  const helpGroup = col.addGroup("Access Note");
  helpGroup.addStaticText(
    "",
    "Affinity script filesystem access is limited to the Desktop. Put your CSV on the Desktop before importing.",
  ).isFullWidth = true;

  const result = dlg.runModal();
  if (result.value !== DialogResult.Ok.value) return null;

  let path = manualPathCtrl.text.trim();
  if (csvCtrl && csvCtrl.selectedIndex >= 0 && path === csvPaths[0]) {
    path = csvPaths[csvCtrl.selectedIndex];
  }

  path = cleanFilePath(path);
  if (!path) return null;

  try {
    return readTextFile(path);
  } catch (e) {
    app.alert("Could not read the selected CSV file:\n\n" + e.message);
    return null;
  }
}

// ============================================================
// ADVANCED CSV PARSER
// ============================================================

function parseCSV(csvContent) {
  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;

  // Detecting separator
  let separator = ",";
  if (lines[0].includes(";")) separator = ";";
  if (lines[0].includes("\t")) separator = "\t";

  const headers = lines[0]
    .split(separator)
    .map((h) => h.trim().replace(/^"|"$/g, ""));
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(separator);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      let value = values[j] ? values[j].trim().replace(/^"|"$/g, "") : "";
      // Converting to number if possible
      const numValue = parseFloat(value);
      row[headers[j]] = isNaN(numValue) ? value : numValue;
    }
    data.push(row);
  }

  return { headers, data };
}

// ============================================================
// ADVANCED SETTINGS INTERFACE
// ============================================================

function showAdvancedConfigDialog(csvData, previousConfig = null) {
  const dlg = Dialog.create("ChartsPro");
  dlg.initialWidth = 380;
  dlg.isResizable = true;

  const leftCol = dlg.addColumn();
  const rightCol = dlg.addColumn();

  function combo(group, label, items, selectedIndex = 0, description = "") {
    const ctrl = group.addComboBox(label, items, selectedIndex);
    ctrl.isFullWidth = true;
    if (description) ctrl.description = description;
    return ctrl;
  }

  function sliderEditor(
    group,
    label,
    initial,
    min,
    max,
    precision = 0,
    description = "",
  ) {
    const ctrl = group.addUnitValueEditor(
      label,
      UnitType.Number,
      UnitType.Number,
      initial,
      min,
      max,
    );
    ctrl.precision = precision;
    ctrl.showPopupSlider = true;
    if (description) ctrl.description = description;
    return ctrl;
  }

  // LEFT COLUMN: data source, chart type, and dimensions.
  const dataGroup = leftCol.addGroup("Data");

  const chartTypeCtrl = combo(
    dataGroup,
    "Chart",
    [
      CHART_TYPES.PIE.name,
      CHART_TYPES.DOUGHNUT.name,
      CHART_TYPES.BAR.name,
      CHART_TYPES.BAR_HORIZONTAL.name,
      CHART_TYPES.LINE.name,
      CHART_TYPES.RADAR.name,
    ],
    0,
    "Select the chart style for the imported CSV values.",
  );

  const labelOptions = csvData.headers;
  const labelCtrl = combo(
    dataGroup,
    "Labels",
    labelOptions,
    0,
    "Column used for category names.",
  );
  const valueCtrl = combo(
    dataGroup,
    "Values",
    labelOptions,
    Math.min(1, labelOptions.length - 1),
    "Column used for numeric chart values.",
  );

  const sizeGroup = leftCol.addGroup("Geometry");
  const widthCtrl = sliderEditor(
    sizeGroup,
    "Width",
    800,
    400,
    2000,
    0,
    "Chart document width in pixels.",
  );
  const heightCtrl = sliderEditor(
    sizeGroup,
    "Height",
    600,
    400,
    2000,
    0,
    "Chart document height in pixels.",
  );

  const pieGroup = leftCol.addGroup("Pie / Doughnut");
  const radiusCtrl = sliderEditor(
    pieGroup,
    "Radius %",
    70,
    30,
    95,
    0,
    "Outer radius for pie and doughnut charts.",
  );
  const doughnutHoleCtrl = sliderEditor(
    pieGroup,
    "Hole %",
    40,
    0,
    80,
    0,
    "Inner hole size for doughnut charts.",
  );
  const startAngleCtrl = sliderEditor(
    pieGroup,
    "Start angle",
    -90,
    -360,
    360,
    0,
    "Rotation offset for pie and doughnut charts.",
  );

  const barGroup = leftCol.addGroup("Bars / Lines");
  const barWidthRatioCtrl = sliderEditor(
    barGroup,
    "Bar width %",
    70,
    30,
    90,
    0,
    "Width of bars relative to each category slot.",
  );
  const showValuesOnBarsCtrl = barGroup.addCheckBox(
    "Show values on bars",
    false,
  );

  // RIGHT COLUMN: visual style and actions.
  const colorGroup = rightCol.addGroup("Colour");
  const paletteCtrl = combo(
    colorGroup,
    "Palette",
    Object.keys(COLOR_PALETTES),
    0,
    "Colour palette used across chart marks.",
  );
  const reverseColorsCtrl = colorGroup.addCheckBox(
    "Reverse colour order",
    false,
  );

  const axisGroup = rightCol.addGroup("Axes");
  const showGridCtrl = axisGroup.addCheckBox("Show Grid", true);
  const showAxisCtrl = axisGroup.addCheckBox("Show Axes", true);
  const axisColorCtrl = combo(axisGroup, "Colour", ["Gray", "Black", "Blue"]);

  const legendGroup = rightCol.addGroup("Legend");
  const showLegendCtrl = legendGroup.addCheckBox("Show Legend", true);
  const legendPositionCtrl = combo(
    legendGroup,
    "Position",
    ["Right", "Left", "Bottom"],
    0,
  );
  const valueFormatCtrl = combo(
    legendGroup,
    "Values",
    ["Percentage", "Value", "Both", "None"],
    0,
  );

  const actionGroup = rightCol.addGroup("Action");
  const statusTxt = actionGroup.addStaticText("", "");
  statusTxt.isFullWidth = true;
  const actionBtns = actionGroup.addButtonSet("", ["Preview", "Apply"], 0);
  actionBtns.isFullWidth = true;

  if (previousConfig) {
    const chartTypes = Object.values(CHART_TYPES);
    const chartTypeIndex = chartTypes.findIndex(
      (type) => type.id === previousConfig.chartType,
    );
    if (chartTypeIndex >= 0) chartTypeCtrl.selectedIndex = chartTypeIndex;

    const labelIndex = labelOptions.indexOf(previousConfig.labelColumn);
    if (labelIndex >= 0) labelCtrl.selectedIndex = labelIndex;

    const valueIndex = labelOptions.indexOf(previousConfig.valueColumn);
    if (valueIndex >= 0) valueCtrl.selectedIndex = valueIndex;

    const paletteIndex = Object.keys(COLOR_PALETTES).findIndex(
      (key) => COLOR_PALETTES[key].name === previousConfig.paletteName,
    );
    if (paletteIndex >= 0) paletteCtrl.selectedIndex = paletteIndex;

    reverseColorsCtrl.value = previousConfig.reverseColors;
    widthCtrl.value = previousConfig.width;
    heightCtrl.value = previousConfig.height;
    showGridCtrl.value = previousConfig.showGrid;
    showAxisCtrl.value = previousConfig.showAxes;
    showLegendCtrl.value = previousConfig.showLegend;
    radiusCtrl.value = previousConfig.radius;
    doughnutHoleCtrl.value = previousConfig.doughnutHole;
    startAngleCtrl.value = previousConfig.startAngle;
    barWidthRatioCtrl.value = previousConfig.barWidthRatio * 100;
    showValuesOnBarsCtrl.value = previousConfig.showValuesOnBars;
  }

  function getConfig() {
    // Data retrieval
    const labelColumn = labelOptions[labelCtrl.selectedIndex];
    const valueColumn = labelOptions[valueCtrl.selectedIndex];
    const labels = csvData.data.map((row) => String(row[labelColumn]));
    const values = csvData.data.map((row) => {
      const val = row[valueColumn];
      return typeof val === "number" ? val : parseFloat(val) || 0;
    });

    // Palette
    const paletteNames = Object.keys(COLOR_PALETTES);
    const selectedPalette =
      COLOR_PALETTES[paletteNames[paletteCtrl.selectedIndex]];
    let paletteColors = [...selectedPalette.colors];
    if (reverseColorsCtrl.value) paletteColors.reverse();

    // Chart type
    const chartTypeId =
      Object.values(CHART_TYPES)[chartTypeCtrl.selectedIndex].id;

    // Axes color
    const axisColors = {
      Gray: { r: 150, g: 150, b: 150, alpha: 255 },
      Black: { r: 30, g: 30, b: 30, alpha: 255 },
      Blue: { r: 18, g: 48, b: 136, alpha: 255 },
    };
    const axisColorNames = Object.keys(axisColors);
    const axisColor =
      axisColors[axisColorNames[axisColorCtrl.selectedIndex]] ||
      axisColors["Gray"];

    // Legend position
    const legendPositionNames = ["Right", "Left", "Bottom"];
    const legendPositions = { Right: "right", Left: "left", Bottom: "bottom" };

    // Value format
    const valueFormatNames = ["Percentage", "Value", "Both", "None"];
    const valueFormats = {
      Percentage: FORMAT_OPTIONS.PERCENTAGE,
      Value: FORMAT_OPTIONS.VALUE,
      Both: FORMAT_OPTIONS.BOTH,
      None: null,
    };

    return {
      chartType: chartTypeId,
      labelColumn: labelColumn,
      valueColumn: valueColumn,
      labels: labels,
      values: values,
      paletteName: selectedPalette.name,
      reverseColors: reverseColorsCtrl.value,
      palette: paletteColors,
      width: Math.round(widthCtrl.value),
      height: Math.round(heightCtrl.value),
      showGrid: showGridCtrl.value,
      showAxes: showAxisCtrl.value,
      axisColor: axisColor,
      axisWidth: 1,
      gridColor: { r: 220, g: 220, b: 220, alpha: 255 },
      gridWidth: 0.5,
      showLegend: showLegendCtrl.value,
      legendPosition:
        legendPositions[legendPositionNames[legendPositionCtrl.selectedIndex]] ||
        "right",
      legendY: 80,
      legendItemHeight: 25,
      showValues: valueFormats[valueFormatNames[valueFormatCtrl.selectedIndex]],
      radius: radiusCtrl.value,
      doughnutHole: doughnutHoleCtrl.value,
      startAngle: startAngleCtrl.value,
      barWidthRatio: barWidthRatioCtrl.value / 100,
      showValuesOnBars: showValuesOnBarsCtrl.value,
      showPoints: true,
      pointSize: 6,
      lineWidth: 2,
      lineColor: paletteColors[0],
      margin: { top: 80, bottom: 80, left: 80, right: 200 },
    };
  }

  let previewGroup = null;
  function clearPreview() {
    deleteNodeSafe(Document.current, previewGroup);
    previewGroup = null;
    clearDocumentPreviews(Document.current);
  }

  function showPreview(initial) {
    clearPreview();

    try {
      const config = getConfig();
      previewGroup = generateChart(config, true);
      if (!previewGroup) throw new Error("Preview command failed");
      statusTxt.text =
        (initial ? "Initial preview" : "Preview") +
        ": " +
        config.labels.length +
        " rows, " +
        config.paletteName +
        ", " +
        config.width +
        " x " +
        config.height +
        " px";
    } catch (e) {
      statusTxt.text = "Preview error: " + (e && e.message ? e.message : e);
    }
  }

  statusTxt.text = "Building initial preview...";
  showPreview(true);

  while (true) {
    actionBtns.selectedIndex = 0;
    const result = dlg.runModal();
    const mode = actionBtns.selectedIndex;

    if (result.value !== DialogResult.Ok.value) {
      clearPreview();
      return null;
    }

    if (mode === 1) {
      const config = getConfig();
      clearPreview();
      return config;
    }

    showPreview(false);
  }
}

// ============================================================
// MAIN CHART GENERATION
// ============================================================

function generateChart(config, isPreview = false) {
  const doc = Document.current;
  if (!doc) return null;

  const chartName =
    Object.values(CHART_TYPES).find((type) => type.id === config.chartType)
      ?.name || config.chartType;
  const baseLayerName = chartName.replace(/\bChart\b/g, "chart");
  const layerName = isPreview ? baseLayerName + " preview" : baseLayerName;

  let chartLayer = null;
  try {
    const layerBuilder = AddChildNodesCommandBuilder.create();
    layerBuilder.addContainerNode(ContainerNodeDefinition.create(layerName));
    const layerCommand = layerBuilder.createCommand(false, NodeChildType.Main);
    exec(doc, layerCommand, false);
    chartLayer = layerCommand.newNodes && layerCommand.newNodes[0];
  } catch (e) {
    return null;
  }

  if (!chartLayer) return null;

  const drawOffset = getCenteredDrawOffset(doc, config.width, config.height);
  const previousOffsetX = DRAW_OFFSET_X;
  const previousOffsetY = DRAW_OFFSET_Y;
  DRAW_OFFSET_X = drawOffset.x;
  DRAW_OFFSET_Y = drawOffset.y;

  const builder = AddChildNodesCommandBuilder.create();
  builder.setInsertionTarget(chartLayer);

  try {
    switch (config.chartType) {
      case CHART_TYPES.PIE.id:
      case CHART_TYPES.DOUGHNUT.id:
        generatePieChart(builder, config.values, config.labels, config);
        break;
      case CHART_TYPES.BAR.id:
        generateBarChart(builder, config.values, config.labels, config);
        break;
      case CHART_TYPES.BAR_HORIZONTAL.id:
        generateHorizontalBarChart(builder, config.values, config.labels, config);
        break;
      case CHART_TYPES.LINE.id:
        generateLineChart(builder, config.values, config.labels, config);
        break;
      case CHART_TYPES.RADAR.id:
        generateRadarChart(builder, config.values, config.labels, config);
        break;
    }
  } catch (e) {
    DRAW_OFFSET_X = previousOffsetX;
    DRAW_OFFSET_Y = previousOffsetY;
    deleteNodeSafe(doc, chartLayer);
    return null;
  }

  try {
    const cmd = builder.createCommand(false, NodeChildType.Main);
    exec(doc, cmd, false);
  } catch (e) {
    DRAW_OFFSET_X = previousOffsetX;
    DRAW_OFFSET_Y = previousOffsetY;
    deleteNodeSafe(doc, chartLayer);
    return null;
  }

  if (config.showLegend) {
    let legendLayer = null;
    try {
      const legendLayerBuilder = AddChildNodesCommandBuilder.create();
      legendLayerBuilder.setInsertionTarget(chartLayer);
      legendLayerBuilder.addContainerNode(
        ContainerNodeDefinition.create(baseLayerName + " legend"),
      );
      const legendLayerCommand = legendLayerBuilder.createCommand(
        false,
        NodeChildType.Main,
      );
      exec(doc, legendLayerCommand, false);
      legendLayer =
        legendLayerCommand.newNodes && legendLayerCommand.newNodes[0];

      const legendBuilder = AddChildNodesCommandBuilder.create();
      legendBuilder.setInsertionTarget(legendLayer);

      const total = config.values.reduce((sum, value) => sum + value, 0);
      generateLegend(
        legendBuilder,
        config.labels.map((label, i) => ({
          label: label,
          value: config.values[i],
          percentage: total ? (config.values[i] / total) * 100 : 0,
          color: config.palette[i % config.palette.length],
        })),
        config,
      );

      const legendCommand = legendBuilder.createCommand(
        false,
        NodeChildType.Main,
      );
      exec(doc, legendCommand, false);
    } catch (e) {
      DRAW_OFFSET_X = previousOffsetX;
      DRAW_OFFSET_Y = previousOffsetY;
      deleteNodeSafe(doc, chartLayer);
      return null;
    }
  }

  DRAW_OFFSET_X = previousOffsetX;
  DRAW_OFFSET_Y = previousOffsetY;
  return chartLayer;
}

function getChartSummary(config) {
  const chartName =
    Object.values(CHART_TYPES).find((t) => t.id === config.chartType)?.name ||
    config.chartType;

  return (
    "Summary:\n" +
    "• Type: " +
    chartName +
    "\n" +
    "• Dimensions: " +
    config.width +
    " x " +
    config.height +
    " px\n" +
    "• Categories: " +
    config.labels.length +
    "\n" +
    "• Palette: " +
    config.paletteName
  );
}

// ============================================================
// MAIN FUNCTION
// ============================================================

async function main() {
  try {
    if (!Document.current) {
      app.alert("Open a document before running ChartsPro.");
      return;
    }

    // Step 1: Import CSV file
    const csvContent = await importCSVFile();
    if (!csvContent) {
      app.alert("No CSV file selected.");
      return;
    }

    // Step 2: Parse CSV
    const csvData = parseCSV(csvContent);
    if (!csvData || csvData.data.length === 0) {
      app.alert(
        "Invalid CSV format. Please ensure your file contains headers and data.",
      );
      return;
    }

    // Step 3: Configure with live preview, then generate the final chart.
    const config = showAdvancedConfigDialog(csvData);
    if (!config) return;

    if (!generateChart(config, false)) {
      app.alert("Error generating the chart.");
      return;
    }
  } catch (e) {
    app.alert("Error: " + e.message);
  }
}

// Execution
main();

module.exports.main = main;
