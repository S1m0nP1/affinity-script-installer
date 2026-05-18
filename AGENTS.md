# Codex Instructions

These instructions apply to this repository.

## Script Updates

When adding, removing, renaming, or updating scripts:

1. Follow `NEW_SCRIPT_WORKFLOW.md`.
2. Treat script metadata comments as the source of truth.
3. Always run `node tools/generate-scripts-json.mjs`.
4. Always add or preserve `es`, `fr`, `de`, and `ja` translations for new or renamed scripts.
5. Optimize new thumbnail PNGs before committing.
6. Validate that every `scripts.json` script path and image path exists.
7. Stage only intended files and leave unrelated untracked files alone.
8. Commit and push when the user asks to publish.

## Useful Validation Commands

Validate manifest references:

```sh
node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync('scripts.json','utf8')); const missing=[]; for (const s of data.scripts) { if (!fs.existsSync(s.path)) missing.push('script '+s.path); if (s.image && !fs.existsSync(s.image)) missing.push('image '+s.image+' for '+s.id); } if (missing.length) { console.error(missing.join('\n')); process.exit(1); } console.log(data.scripts.length+' entries validated');"
```

Check a new script has translations:

```sh
node -e "const data=JSON.parse(require('fs').readFileSync('scripts.json','utf8')); const s=data.scripts.find(x=>x.path==='scripts/my-script.js'); if (!s?.translations?.es || !s?.translations?.fr || !s?.translations?.de || !s?.translations?.ja) process.exit(1); console.log('translations ok');"
```
