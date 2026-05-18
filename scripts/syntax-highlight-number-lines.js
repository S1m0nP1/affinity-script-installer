// @title Syntax Highlight and Number Code
// @description Adds line numbers and syntax highlighting to the selected Affinity text frame.
// @author S1m0nP1
// @version 1.0.0
// @updated 2026-05-18
// @affinity 3.2+
// @verified true
// @homepage https://affinityhub.js.org/
// @github https://github.com/S1m0nP1/affinity-script-installer
// @tags code, syntax, text, line numbers
// @image images/syntax.png

'use strict';

const { app } = require('/application');
const { Document } = require('/document');
const { Dialog, DialogResult } = require('/dialog');
const { Selection, TextSelection } = require('/selections');
const { StoryRange } = require('affinity:story');
const { StoryDelta } = require('/storydelta');
const { FillDescriptor } = require('/fills');
const { RGBA8 } = require('/colours');
const { DocumentCommand } = require('/commands');
const { ParagraphAttDoubleType, ParagraphAttStringType } = require('/paragraphatts');
const { FontWeight } = require('/fonts');

const LANGUAGES = ['Auto', 'JavaScript / TypeScript', 'HTML / XML', 'CSS', 'Python', 'JSON', 'Plain text'];
const FRAME_INSET_MM = 4;

const THEME = {
  background: [0, 0, 0],
  gutter: [34, 34, 34],
  base: [170, 170, 170],
  lineNumber: [145, 145, 145],
  comment: [106, 153, 85],
  keyword: [86, 156, 214],
  string: [156, 220, 254],
  number: [255, 139, 37],
  functionName: [220, 220, 170],
  operator: [170, 170, 170],
  tag: [86, 156, 214],
  attr: [156, 220, 254],
  punctuation: [170, 170, 170],
  selector: [220, 220, 170],
  property: [156, 220, 254],
  value: [156, 220, 254],
};

const JS_KEYWORDS = new Set([
  'abstract', 'as', 'async', 'await', 'boolean', 'break', 'case', 'catch', 'class', 'const',
  'constructor', 'continue', 'debugger', 'declare', 'default', 'delete', 'do', 'else', 'enum',
  'export', 'extends', 'false', 'finally', 'for', 'from', 'function', 'get', 'if', 'implements',
  'import', 'in', 'infer', 'instanceof', 'interface', 'is', 'keyof', 'let', 'module', 'namespace',
  'new', 'null', 'number', 'of', 'package', 'private', 'protected', 'public', 'readonly', 'return',
  'set', 'static', 'string', 'super', 'switch', 'symbol', 'this', 'throw', 'true', 'try', 'type',
  'typeof', 'undefined', 'unique', 'unknown', 'var', 'void', 'while', 'with', 'yield',
]);

const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import',
  'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while',
  'with', 'yield',
]);

function isTextFrameNode(node) {
  return Boolean(node && node.isFrameTextNode && node.storyInterface && node.storyInterface.story);
}

function getSelectedFrameNode(doc) {
  const nodes = doc.selection.nodes;
  if (!nodes || nodes.length !== 1) {
    throw new Error('Select exactly one text frame containing code, then run the script.');
  }

  const node = nodes.first;
  if (!isTextFrameNode(node)) {
    throw new Error('The selected object is not a frame text node.');
  }

  return node;
}

function normalizeNewlines(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function trimLeadingBlankLines(text) {
  return normalizeNewlines(text).replace(/^(?:[ \t]*\n)+/, '');
}

function stripExistingLineNumbers(text) {
  const lines = normalizeNewlines(text).split('\n');
  let matched = 0;
  const stripped = lines.map((line) => {
    const match = line.match(/^\s*\d+\s+[|:]?\s?(.*)$/);
    if (match) {
      matched += 1;
      return match[1];
    }
    return line;
  });

  return matched >= Math.max(2, Math.ceil(lines.length * 0.6)) ? stripped.join('\n') : text;
}

function detectLanguage(code) {
  const sample = code.slice(0, 4000);
  const trimmed = sample.trim();

  if (/^\s*[{[]/.test(trimmed) && /"[A-Za-z0-9_$-]+"\s*:/.test(trimmed)) return 'JSON';
  if (/<[A-Za-z][\w:-]*(\s+[\w:-]+(=("[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/.test(sample)) return 'HTML / XML';
  if (/(^|\n)\s*(def|class|from|import|elif|async def)\s+/.test(sample)) return 'Python';
  if (/[.#]?[A-Za-z][\w-]*\s*\{[\s\S]*:[\s\S]*;?/.test(sample) && !/\b(function|const|let|var|=>)\b/.test(sample)) return 'CSS';
  if (/\b(function|const|let|var|import|export|interface|type|=>|console\.log)\b/.test(sample)) return 'JavaScript / TypeScript';
  return 'Plain text';
}

function pushToken(tokens, start, end, kind) {
  if (end > start) tokens.push({ start, end, kind });
}

function readQuoted(code, i) {
  const quote = code[i];
  let j = i + 1;
  while (j < code.length) {
    if (code[j] === '\\') {
      j += 2;
      continue;
    }
    if (code[j] === quote) return j + 1;
    j += 1;
  }
  return code.length;
}

function readTemplate(code, i) {
  let j = i + 1;
  while (j < code.length) {
    if (code[j] === '\\') {
      j += 2;
      continue;
    }
    if (code[j] === '`') return j + 1;
    j += 1;
  }
  return code.length;
}

function lexCStyle(code, keywords) {
  const tokens = [];
  let i = 0;

  while (i < code.length) {
    const ch = code[i];

    if (ch === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i);
      const j = end === -1 ? code.length : end;
      pushToken(tokens, i, j, 'comment');
      i = j;
      continue;
    }

    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      const j = end === -1 ? code.length : end + 2;
      pushToken(tokens, i, j, 'comment');
      i = j;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const j = readQuoted(code, i);
      pushToken(tokens, i, j, 'string');
      i = j;
      continue;
    }

    if (ch === '`') {
      const j = readTemplate(code, i);
      pushToken(tokens, i, j, 'string');
      i = j;
      continue;
    }

    const number = code.slice(i).match(/^(0x[\da-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/);
    if (number) {
      pushToken(tokens, i, i + number[0].length, 'number');
      i += number[0].length;
      continue;
    }

    const word = code.slice(i).match(/^[A-Za-z_$][\w$]*/);
    if (word) {
      const text = word[0];
      const end = i + text.length;
      let j = end;
      while (/\s/.test(code[j] || '')) j += 1;
      if (keywords.has(text)) pushToken(tokens, i, end, 'keyword');
      else if (code[j] === '(') pushToken(tokens, i, end, 'functionName');
      i = end;
      continue;
    }

    if (/^[{}()[\].,;:+\-*/%=!<>&|?~^]/.test(ch)) {
      pushToken(tokens, i, i + 1, 'operator');
    }
    i += 1;
  }

  return tokens;
}

function lexPython(code) {
  const tokens = [];
  let i = 0;

  while (i < code.length) {
    const ch = code[i];

    if (ch === '#') {
      const end = code.indexOf('\n', i);
      const j = end === -1 ? code.length : end;
      pushToken(tokens, i, j, 'comment');
      i = j;
      continue;
    }

    if ((ch === '"' || ch === "'") && code[i + 1] === ch && code[i + 2] === ch) {
      const quote = ch.repeat(3);
      const end = code.indexOf(quote, i + 3);
      const j = end === -1 ? code.length : end + 3;
      pushToken(tokens, i, j, 'string');
      i = j;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const j = readQuoted(code, i);
      pushToken(tokens, i, j, 'string');
      i = j;
      continue;
    }

    const number = code.slice(i).match(/^(\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i);
    if (number) {
      pushToken(tokens, i, i + number[0].length, 'number');
      i += number[0].length;
      continue;
    }

    const word = code.slice(i).match(/^[A-Za-z_]\w*/);
    if (word) {
      const text = word[0];
      const end = i + text.length;
      let j = end;
      while (/\s/.test(code[j] || '')) j += 1;
      if (PY_KEYWORDS.has(text)) pushToken(tokens, i, end, 'keyword');
      else if (code[j] === '(') pushToken(tokens, i, end, 'functionName');
      i = end;
      continue;
    }

    if (/^[{}()[\].,;:+\-*/%=!<>&|~^]/.test(ch)) {
      pushToken(tokens, i, i + 1, 'operator');
    }
    i += 1;
  }

  return tokens;
}

function lexJson(code) {
  const tokens = [];
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '"') {
      const j = readQuoted(code, i);
      let k = j;
      while (/\s/.test(code[k] || '')) k += 1;
      pushToken(tokens, i, j, code[k] === ':' ? 'property' : 'string');
      i = j;
      continue;
    }
    const number = code.slice(i).match(/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i);
    if (number) {
      pushToken(tokens, i, i + number[0].length, 'number');
      i += number[0].length;
      continue;
    }
    const literal = code.slice(i).match(/^(true|false|null)\b/);
    if (literal) {
      pushToken(tokens, i, i + literal[0].length, 'keyword');
      i += literal[0].length;
      continue;
    }
    if (/^[{}[\],:]/.test(ch)) pushToken(tokens, i, i + 1, 'punctuation');
    i += 1;
  }
  return tokens;
}

function lexHtml(code) {
  const tokens = [];
  let i = 0;
  while (i < code.length) {
    if (code.startsWith('<!--', i)) {
      const end = code.indexOf('-->', i + 4);
      const j = end === -1 ? code.length : end + 3;
      pushToken(tokens, i, j, 'comment');
      i = j;
      continue;
    }

    if (code[i] === '<') {
      const close = code.indexOf('>', i + 1);
      const j = close === -1 ? code.length : close + 1;
      const tagText = code.slice(i, j);
      const tagMatch = tagText.match(/^<\/?\s*([A-Za-z][\w:-]*)/);
      pushToken(tokens, i, Math.min(i + tagText.length, i + 1), 'punctuation');
      if (tagMatch) {
        const tagStart = i + tagMatch.index + tagMatch[0].lastIndexOf(tagMatch[1]);
        pushToken(tokens, tagStart, tagStart + tagMatch[1].length, 'tag');
      }

      const attrRe = /\s([A-Za-z_:][\w:.-]*)(\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
      let match;
      while ((match = attrRe.exec(tagText)) !== null) {
        const attrStart = i + match.index + 1;
        pushToken(tokens, attrStart, attrStart + match[1].length, 'attr');
        if (match[3]) {
          const valueStart = i + match.index + match[0].lastIndexOf(match[3]);
          pushToken(tokens, valueStart, valueStart + match[3].length, 'string');
        }
      }
      if (j > i + 1) pushToken(tokens, j - 1, j, 'punctuation');
      i = j;
      continue;
    }
    i += 1;
  }
  return tokens;
}

function lexCss(code) {
  const tokens = [];
  let i = 0;
  let inBlock = false;
  while (i < code.length) {
    if (code[i] === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      const j = end === -1 ? code.length : end + 2;
      pushToken(tokens, i, j, 'comment');
      i = j;
      continue;
    }

    if (code[i] === '{') {
      inBlock = true;
      pushToken(tokens, i, i + 1, 'punctuation');
      i += 1;
      continue;
    }

    if (code[i] === '}') {
      inBlock = false;
      pushToken(tokens, i, i + 1, 'punctuation');
      i += 1;
      continue;
    }

    if (code[i] === '"' || code[i] === "'") {
      const j = readQuoted(code, i);
      pushToken(tokens, i, j, 'string');
      i = j;
      continue;
    }

    const number = code.slice(i).match(/^-?\d+(?:\.\d+)?(?:%|[A-Za-z]+)?/);
    if (number) {
      pushToken(tokens, i, i + number[0].length, 'number');
      i += number[0].length;
      continue;
    }

    const ident = code.slice(i).match(/^-?[_A-Za-z][\w-]*/);
    if (ident) {
      const end = i + ident[0].length;
      let j = end;
      while (/\s/.test(code[j] || '')) j += 1;
      if (!inBlock) pushToken(tokens, i, end, 'selector');
      else if (code[j] === ':') pushToken(tokens, i, end, 'property');
      else pushToken(tokens, i, end, 'value');
      i = end;
      continue;
    }

    if (/^[.:;,#()[\]>+~=*|$^]/.test(code[i])) pushToken(tokens, i, i + 1, 'operator');
    i += 1;
  }
  return tokens;
}

function highlightTokens(code, language) {
  if (language === 'JavaScript / TypeScript') return lexCStyle(code, JS_KEYWORDS);
  if (language === 'HTML / XML') return lexHtml(code);
  if (language === 'CSS') return lexCss(code);
  if (language === 'Python') return lexPython(code);
  if (language === 'JSON') return lexJson(code);
  return [];
}

function numberLinesAndMap(code, shouldNumber) {
  const lines = normalizeNewlines(code).split('\n');
  const width = String(lines.length).length;
  const numbered = [];
  const lineNumberRanges = [];
  const lineOffsets = [];
  let sourceOffset = 0;
  let outputOffset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    let prefix = '';
    if (shouldNumber) {
      prefix = `${String(index + 1).padStart(width, ' ')}  `;
      lineNumberRanges.push({ start: outputOffset, end: outputOffset + prefix.length, kind: 'lineNumber' });
    }
    lineOffsets.push({ sourceStart: sourceOffset, outputStart: outputOffset + prefix.length, length: line.length });
    numbered.push(prefix + line);
    sourceOffset += line.length + 1;
    outputOffset += prefix.length + line.length + 1;
  }

  return {
    text: numbered.join('\n'),
    lineNumberRanges,
    lineOffsets,
  };
}

function mapTokenRange(token, lineOffsets) {
  const ranges = [];
  for (let i = 0; i < lineOffsets.length; i += 1) {
    const line = lineOffsets[i];
    const sourceEnd = line.sourceStart + line.length;
    const start = Math.max(token.start, line.sourceStart);
    const end = Math.min(token.end, sourceEnd);
    if (end > start) {
      ranges.push({
        start: line.outputStart + (start - line.sourceStart),
        end: line.outputStart + (end - line.sourceStart),
        kind: token.kind,
      });
    }
  }
  return ranges;
}

function rangesByKind(ranges) {
  const grouped = {};
  for (let i = 0; i < ranges.length; i += 1) {
    const range = ranges[i];
    if (!grouped[range.kind]) grouped[range.kind] = [];
    grouped[range.kind].push(range);
  }
  return grouped;
}

function makeSelection(doc, frameNode, ranges) {
  const storyRanges = [];
  const frameRange = frameNode.storyInterface.storyRange;
  const offset = frameRange ? frameRange.begin : 0;
  const frameEnd = frameRange ? frameRange.end : Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < ranges.length; i += 1) {
    if (ranges[i].end > ranges[i].start) {
      storyRanges.push(new StoryRange(
        offset + ranges[i].start,
        Math.min(offset + ranges[i].end, frameEnd)
      ));
    }
  }
  if (storyRanges.length === 0) return null;

  const selection = Selection.createEmpty(doc);
  selection.addNode(frameNode);
  selection.addSubSelectionForNode(frameNode, TextSelection.create(storyRanges));
  return selection;
}

function makeExistingStorySelection(doc, frameNode) {
  const range = frameNode.storyInterface.storyRange;
  const selection = Selection.createEmpty(doc);
  selection.addNode(frameNode);
  selection.addSubSelectionForNode(frameNode, TextSelection.create(new StoryRange(range.begin, range.end)));
  return selection;
}

function colourFill(name) {
  const c = THEME[name] || THEME.base;
  return FillDescriptor.createSolid(RGBA8(c[0], c[1], c[2], 255));
}

function mmToDocUnits(doc, mm) {
  return mm * doc.dpi / 25.4;
}

function applyTextDelta(doc, selection, delta) {
  if (!selection) return;
  if (typeof doc.formatText === 'function') {
    doc.formatText(delta, selection);
    return;
  }

  doc.executeCommand(DocumentCommand.createFormatText(selection, delta));
}

function setFrameText(doc, frameNode, text) {
  doc.executeCommand(DocumentCommand.createSetText(makeExistingStorySelection(doc, frameNode), text));
}

function setFrameBackground(doc, frameNode) {
  try {
    doc.executeCommand(DocumentCommand.createSetBrushFill(
      Selection.create(doc, [frameNode], true),
      colourFill('background')
    ));
  } catch (error) {
    // Some text objects may reject frame fills; syntax colour still applies.
  }
}

function applyFormatting(doc, frameNode, formattedText, groupedRanges) {
  const wholeSelection = makeSelection(doc, frameNode, [{ start: 0, end: formattedText.length, kind: 'base' }]);
  const lineNumberSelection = makeSelection(doc, frameNode, groupedRanges.lineNumber || []);

  try {
    applyTextDelta(doc, wholeSelection, StoryDelta.createParagraphString(ParagraphAttStringType.StyleName, 'Code'));
  } catch (error) {
    // Continue if the document has no paragraph style named Code.
  }

  try {
    applyTextDelta(doc, wholeSelection, StoryDelta.createParagraphDouble(ParagraphAttDoubleType.SpaceAfter, 3 * doc.dpi / 72));
  } catch (error) {
    // Paragraph spacing is a refinement; keep syntax formatting if the host rejects it.
  }

  for (const familyName of ['Courier New', 'Courier', 'Courier Prime', 'Menlo', 'Monaco']) {
    try {
      applyTextDelta(doc, wholeSelection, StoryDelta.createFamilyName(familyName));
      break;
    } catch (error) {
      // Try the next common monospace family.
    }
  }

  applyTextDelta(doc, wholeSelection, StoryDelta.createWeight(FontWeight.Bold));

  try {
    const inset = mmToDocUnits(doc, FRAME_INSET_MM);
    applyTextDelta(doc, wholeSelection, StoryDelta.createLeftIndent(inset));
    applyTextDelta(doc, wholeSelection, StoryDelta.createRightIndent(inset));
  } catch (error) {
    // Text-frame inset is not exposed by the SDK; paragraph indents are the closest reliable fallback.
  }

  applyTextDelta(doc, wholeSelection, StoryDelta.createBrushFill(colourFill('base')));
  applyTextDelta(doc, lineNumberSelection, StoryDelta.createHighlightFill(colourFill('gutter')));

  const order = [
    'lineNumber', 'comment', 'string', 'number', 'keyword', 'functionName',
    'tag', 'attr', 'selector', 'property', 'value', 'operator', 'punctuation',
  ];

  for (let i = 0; i < order.length; i += 1) {
    const kind = order[i];
    const ranges = groupedRanges[kind];
    if (!ranges || ranges.length === 0) continue;
    applyTextDelta(doc, makeSelection(doc, frameNode, ranges), StoryDelta.createBrushFill(colourFill(kind)));
  }
}

function chooseOptions(detectedLanguage) {
  const detectedIndex = Math.max(0, LANGUAGES.indexOf(detectedLanguage));
  const dialog = Dialog.create('Syntax Highlight Code');
  dialog.initialWidth = 430;

  const column = dialog.addColumn();
  const group = column.addGroup('Options');
  const languageControl = group.addComboBox('Language', LANGUAGES, detectedIndex);
  const lineNumbersControl = group.addCheckBox('Add line numbers', true);
  const stripControl = group.addCheckBox('Strip existing line numbers first', true);

  const result = dialog.runModal();
  if (result.value !== DialogResult.Ok.value) return null;

  return {
    language: LANGUAGES[languageControl.selectedIndex],
    addLineNumbers: lineNumbersControl.value,
    stripExistingNumbers: stripControl.value,
  };
}

function formatSelectedCodeFrame() {
  const doc = Document.current;
  if (!doc) throw new Error('No open document.');

  const frameNode = getSelectedFrameNode(doc);
  let code = trimLeadingBlankLines(frameNode.storyInterface.getText(0, -1));
  const detectedLanguage = detectLanguage(code);
  const options = chooseOptions(detectedLanguage);
  if (!options) return null;

  if (options.stripExistingNumbers) {
    code = stripExistingLineNumbers(code);
  }

  const language = options.language === 'Auto' ? detectLanguage(code) : options.language;
  const numbered = numberLinesAndMap(code, options.addLineNumbers);
  const rawTokens = highlightTokens(code, language);
  const mappedTokenRanges = [];

  for (let i = 0; i < rawTokens.length; i += 1) {
    const mapped = mapTokenRange(rawTokens[i], numbered.lineOffsets);
    for (let j = 0; j < mapped.length; j += 1) mappedTokenRanges.push(mapped[j]);
  }

  const grouped = rangesByKind(numbered.lineNumberRanges.concat(mappedTokenRanges));

  setFrameText(doc, frameNode, numbered.text);
  setFrameBackground(doc, frameNode);
  applyFormatting(doc, frameNode, numbered.text, grouped);
  doc.selection = Selection.create(doc, frameNode);

  return {
    language,
    lines: numbered.lineOffsets.length,
    tokens: rawTokens.length,
  };
}

function main() {
  try {
    const result = formatSelectedCodeFrame();
    if (result) {
      app.alert(
        `Formatted code as ${result.language}.\n\nLines: ${result.lines}\nHighlighted tokens: ${result.tokens}`,
        'Syntax Highlight Complete'
      );
    }
  } catch (error) {
    app.alert(error.message || String(error), 'Syntax Highlight Failed');
  }
}

module.exports.main = main;
module.exports.formatSelectedCodeFrame = formatSelectedCodeFrame;

main();
