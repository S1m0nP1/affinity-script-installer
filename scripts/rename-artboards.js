// @title Artboard Batch Renamer
// @description Renames all artboards in the current document in bulk. When executed, a dialog prompts for a base name, which is then applied to all artboards with automatic sequential numbering and zero-padding — ensuring correct alphabetical sort order when exporting files (e.g., Name 01, Name 02... instead of Name 1, Name 2). For 100+ artboards, padding adjusts to 3 digits automatically. If only one artboard exists, no number is appended.
// @author Heitor Hatherly
// @version 1.0.0
// @affinity 
// @verified 
// @homepage 
// @github 
// @tags 
// @image 

/**
 * name: Rename Artboards
 * description: Batch rename all artboards in a document with sequential numbering.
 * version: 1.0.0
 * author: Heitor Hatherly
 */

const { Document } = require('/document.js');
const { Dialog, DialogResult } = require('/dialog.js');

const doc = Document.current;
if (!doc) { console.log('Erro: nenhum documento aberto.'); }

const artboards = [];
for (const spread of doc.spreads) {
  for (const layer of spread.layers) {
    if (layer.artboardInterface && layer.artboardInterface.isArtboardEnabled) {
      artboards.push(layer);
    }
  }
}

if (artboards.length === 0) {
  console.log('Nenhum artboard encontrado.');
} else {
  const dialog = Dialog.create('Renomear Artboards');
  const col = dialog.addColumn();
  const grp = col.addGroup('');
  const textBox = grp.addTextBox('Nome base:', '');
  textBox.isFullWidth = true;

  const result = dialog.runModal();

  if (result.value === DialogResult.Ok.value) {
    const baseName = textBox.text.trim();
    if (!baseName) {
      console.log('Nome vazio, operação cancelada.');
    } else {
      const total = artboards.length;
      const digits = total > 99 ? 3 : 2;

      artboards.forEach((ab, i) => {
        const num = String(i + 1).padStart(digits, '0');
        const newName = total === 1 ? baseName : `${baseName} ${num}`;
        doc.setLayerDescription(newName, ab);
        console.log('Renomeado: ' + newName);
      });

      console.log('Concluído! ' + total + ' artboard(s) renomeado(s).');
    }
  } else {
    console.log('Cancelado.');
  }
}