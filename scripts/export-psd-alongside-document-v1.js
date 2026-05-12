// @title Export psd 
// @description Export psd (with all layers rasterised) along with .af document
// @author S1m0nP1
// @version 1.0.0
// @affinity 3.2+
// @verified true
// @homepage https://affinityhub.js.org/
// @github https://github.com/S1m0nP1/affinity-script-installer
// @tags utility
// @image images/exportpsd.png


const { Document, FileExportOptions, FileExportArea } = require('/document');
const { DocumentCommand } = require('/commands');
const { Dialog } = require('/dialog');
const { Selection } = require('/selections');
const { LayerEffectType } = require('/layereffects');

function showMessage(title, message) {
    const dlg = Dialog.create(title);
    const col = dlg.addColumn();
    const grp = col.addGroup('');
    grp.addStaticText('', message);
    dlg.runModal();
}

function collectNodesWithColourOverlay(doc) {
    const results = [];

    function walk(node) {
        const lei = node.layerEffectsInterface;
        if (lei) {
            for (const effect of lei.effects) {
                if (effect.type.value === LayerEffectType.ColourOverlay.value && effect.enabled) {
                    results.push(node);
                    break;
                }
            }
        }
        let child = node.firstChild;
        while (child) {
            walk(child);
            child = child.nextSibling;
        }
    }

    let spread = doc.spreads.first;
    while (spread) {
        let child = spread.firstChild;
        while (child) {
            walk(child);
            child = child.nextSibling;
        }
        spread = spread.nextSibling;
    }

    return results;
}

const doc = Document.current;
if (!doc) {
    showMessage('Export PSD', 'No document is currently open.');
} else {
    const docPath = doc.path;
    if (!docPath) {
        showMessage('Export PSD', 'Please save your .af file first — the PSD will be exported alongside it.');
    } else {
        const psdPath = docPath.replace(/\.[^/.]+$/, '') + '.psd';

        const overlayNodes = collectNodesWithColourOverlay(doc);
        let didRasterize = false;

        if (overlayNodes.length > 0) {
            const sel = Selection.create(doc, overlayNodes);
            doc.executeCommand(DocumentCommand.createRasteriseObjects(sel, false, false), false);
            didRasterize = true;
        }

        const exportOptions = FileExportOptions.createWithPresetName('PSD (Final Cut Pro X)');
        const exportArea = FileExportArea.createForWholeDocument();

        doc.exportAsync(psdPath, exportOptions, exportArea, null, (err, records) => {
            if (didRasterize) {
                doc.executeCommand(DocumentCommand.createUndo(), false);
            }

            if (err) {
                showMessage('Export PSD — Error', 'Export failed:\n' + err);
                return;
            }
            const rec = records?.all?.[0];
            if (rec && rec.isSuccess) {
                const suffix = overlayNodes.length > 0
                    ? ` (${overlayNodes.length} Colour Overlay layer${overlayNodes.length > 1 ? 's' : ''} rasterized)`
                    : '';
                showMessage('Export PSD', '✓ Exported successfully:\n' + psdPath + suffix);
            } else {
                showMessage('Export PSD — Error', 'Export issue: ' + (rec?.errorMessage || 'Unknown error'));
            }
        });
    }
}
