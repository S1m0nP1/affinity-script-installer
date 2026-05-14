# Script Submission Process

Use this checklist when adding a new community script from a GitHub issue.

## 1. Review the issue

- Confirm the script source is attached or pasted in the **Script source or attachment** field.
- Confirm the author has permission to share the script publicly.
- Check the safety notes for filesystem, network, AI, or destructive document operations.
- If a thumbnail was provided, download or copy it into `images/` and keep the filename short and descriptive.

## 2. Add the script file

- Save the submitted script in `scripts/`.
- Prefer a lowercase, hyphenated filename, for example `my-script-name.js`.
- Preserve useful metadata comments at the top of the script, such as `@title`, `@description`, `@author`, `@version`, `@affinity`, and `@tags`.

## 3. Update `scripts.json`

Add a new entry to the `scripts` array:

```json
{
  "id": "my-script-name",
  "title": "My Script Name",
  "description": "Short plain-language description of what the script does.",
  "path": "scripts/my-script-name.js",
  "image": "images/my-script-name.png",
  "author": "AuthorHandle",
  "homepage": "",
  "github": "",
  "version": "1.0.0",
  "affinity": "3.2+",
  "verified": false,
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
  },
  "tags": []
}
```

## 4. Translation rules

- Translate only the card title and description in `scripts.json`.
- Do not translate script source code, script comments, filenames, IDs, paths, author handles, version numbers, or tags.
- If the contributor supplied translations, review them for clarity and paste them into the matching language fields.
- If no translations were supplied, add concise translations during review.
- Keep descriptions practical and short. The card should explain what the script does, not rewrite the whole README.

## 5. Validate locally

Run:

```sh
node -e "JSON.parse(require('fs').readFileSync('scripts.json','utf8')); console.log('scripts.json ok')"
```

Then serve the site locally and switch between `EN`, `ES`, `FR`, `DE`, and `JA` to confirm:

- The new card title and description translate.
- The selected script detail translates.
- The code preview remains unchanged source code.

## 6. Final review

- Make sure the thumbnail loads and is not huge.
- Make sure the install title/description fields use the selected language.
- Set `verified` to `true` only after the script has been reviewed and tested.

## 7. Commit and publish

Check what changed:

```sh
git status --short
git diff --stat
```

Stage the script, manifest, thumbnail, and any docs:

```sh
git add scripts/my-script-name.js scripts.json images/my-script-name.png SCRIPT_SUBMISSION_PROCESS.md
```

Commit with a short message:

```sh
git commit -m "Add My Script Name"
```

Push to GitHub:

```sh
git push origin main
```

After pushing, check the GitHub Pages site once it has deployed.
