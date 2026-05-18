# New Script Workflow

Use this workflow when adding or updating scripts, thumbnails, and catalog metadata.

## Quick Checklist

1. Add the script file to `scripts/`.
2. Add or update the script metadata header.
3. Add the thumbnail image to `images/`.
4. Optimize the thumbnail.
5. Run `node tools/generate-scripts-json.mjs`.
6. Add translations to the generated `scripts.json` entry.
7. Validate script and image paths.
8. Commit only the intended files.
9. Push `main`.

## Script Metadata Header

Put metadata at the top of the script. The generator reads these comments and builds `scripts.json`.

```js
// @id syntax-highlight-number-lines
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
```

Use one `@changelog` line per change when updating an existing script:

```js
// @changelog Added live preview.
// @changelog Fixed cancel cleanup.
```

Avoid blank metadata lines such as `// @changelog` because they become empty manifest entries.

## Thumbnail Images

Store thumbnails in `images/` and reference them with `@image`.

Keep thumbnails small. A good target is roughly `900-1200px` wide and under `100 KB` when possible.

If only built-in/local tools are available, this works well for screenshot-style PNGs:

```sh
ffmpeg -y -i images/source.png \
  -vf 'scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=full[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5' \
  -compression_level 9 images/output.png
```

Then check the result:

```sh
file images/output.png
du -h images/output.png
```

If the image has gradients or photos and indexed PNG looks poor, use an RGBA PNG instead:

```sh
ffmpeg -y -i images/source.png \
  -vf scale=1200:-1:flags=lanczos \
  -compression_level 9 -pred mixed images/output.png
```

## Generate The Manifest

Always run this after adding, removing, renaming, or editing script metadata:

```sh
node tools/generate-scripts-json.mjs
```

The generator scans `scripts/` and writes `scripts.json`.

Important behavior:

- Metadata comments in the script file take priority.
- Missing fields fall back to existing manifest data or filename defaults.
- `@updated` should be explicit for new or updated scripts.
- Existing translations are preserved only when the script path stays the same.
- If a script is renamed to a new path, translations must be re-added.

## Add Translations

After generation, add `translations` for the script card title and description:

```json
"translations": {
  "es": {
    "title": "Spanish title",
    "description": "Spanish description."
  },
  "fr": {
    "title": "French title",
    "description": "French description."
  },
  "de": {
    "title": "German title",
    "description": "German description."
  },
  "ja": {
    "title": "Japanese title",
    "description": "Japanese description."
  }
}
```

Translate only user-facing catalog text. Do not translate IDs, filenames, paths, tags, author names, source code, or version strings.

## Validate Before Commit

Validate the manifest and all referenced files:

```sh
node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync('scripts.json','utf8')); const missing=[]; for (const s of data.scripts) { if (!fs.existsSync(s.path)) missing.push('script '+s.path); if (s.image && !fs.existsSync(s.image)) missing.push('image '+s.image+' for '+s.id); } if (missing.length) { console.error(missing.join('\n')); process.exit(1); } console.log(data.scripts.length+' entries validated');"
```

For a specific new script, also check that translations exist:

```sh
node -e "const data=JSON.parse(require('fs').readFileSync('scripts.json','utf8')); const s=data.scripts.find(x=>x.path==='scripts/my-script.js'); if (!s?.translations?.es || !s?.translations?.fr || !s?.translations?.de || !s?.translations?.ja) process.exit(1); console.log('translations ok');"
```

Review the diff:

```sh
git status --short
git diff --stat
git diff -- scripts.json
```

Stage only the intended files:

```sh
git add scripts/my-script.js images/my-script.png scripts.json
```

Leave unrelated untracked files alone.

## Commit And Push

```sh
git commit -m "Add My Script"
git push origin main
```

After pushing, GitHub Pages may take a moment to refresh.

## Better Automation

The best next improvement is a small helper command, for example:

```sh
node tools/add-script.mjs \
  --script scripts/my-script.js \
  --image images/my-script.png \
  --title "My Script" \
  --description "Short catalog description." \
  --author "AuthorName" \
  --version 1.0.0 \
  --verified false
```

That helper should:

- Normalize and insert missing metadata headers.
- Optimize the supplied thumbnail into `images/`.
- Run `tools/generate-scripts-json.mjs`.
- Add or preserve translations from a small JSON sidecar or interactive prompt.
- Validate script and image paths.
- Print the exact `git add` command for the intended files.

A CI check should also run on every pull request:

```sh
node tools/generate-scripts-json.mjs
git diff --exit-code scripts.json
node tools/validate-scripts-json.mjs
```

This would catch stale manifests, missing thumbnails, and accidental script removals before publishing.
