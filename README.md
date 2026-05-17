# Affinity Hub

https://affinityhub.js.org/

## Connection Problems? Try This First

If the site says it cannot connect to Affinity:

1. Open Affinity v3.2 or newer.
2. Enable the local MCP/server feature in Affinity if it is not already enabled.
3. Leave Affinity open, then reload Affinity Hub.
4. Safari is not recommended; please use Chrome, Edge, or Firefox.
5. If your browser asks for permission to access local network devices or local addresses, allow it for Affinity Hub.

Most connection issues come from the browser blocking the local Affinity MCP
endpoint or denying local/private network access. Chrome, Edge, and Firefox are
currently the simplest option for most people.

A static community hub that installs JavaScript scripts from this repository into
a user's local Affinity v3.2 script library through Affinity's built-in MCP
server.

## Download The macOS App

Download the universal macOS app:

[Affinity Hub macOS releases](https://github.com/S1m0nP1/affinity-script-installer/releases/latest)

The DMG is distributed through GitHub Releases. The built app and DMG are not
stored in the repository history.

## How It Works

1. The site loads `scripts.json`.
2. Each manifest entry points to a script file in `scripts/`.
3. The user reviews the script source in the browser.
4. The site connects to the user's local Affinity MCP server.
5. The site calls `save_script_to_library` with the script title, description,
   and source code.


## Add Scripts

Add a JavaScript file under `scripts/`. Put metadata comments at the top of the
file:

```js
// @title My Script
// @description What the script does.
// @author Your Name
// @version 1.0.0
// @updated 2026-05-17
// @changelog Added live preview support.
// @changelog Fixed cancel behavior.
// @affinity 3.2+
// @verified true
// @homepage https://example.com/my-script
// @github https://github.com/example/my-script
// @tags layout, utility
// @image images/my-script.png
```

Then regenerate `scripts.json`:

```bash
node tools/generate-scripts-json.mjs
```

Run this locally from the repository root. The generator scans `.js` and `.mjs`
files in `scripts/`. Metadata comments in the script file take priority. If a
field is missing, the generator falls back to filename-based defaults.

For update metadata, the generator uses:

1. Explicit `@updated` and `@changelog` comments in the script file.
2. If `@updated` is missing and the script file was changed in git today, the
   generator sets `updated` to today's date.
3. Older git dates are not written automatically; scripts that were not updated
   today keep `updated` blank unless an explicit `@updated` comment is present.

Supported metadata:

- `@id my-script`
- `@title My Script`
- `@description What the script does.`
- `@author Your Name`
- `@version 1.0.0`
- `@updated 2026-05-17`
- `@changelog Added live preview support.`
- `@affinity 3.2+`
- `@verified true`
- `@homepage https://example.com/my-script`
- `@github https://github.com/example/my-script`
- `@tags layout, utility`
- `@image images/my-script.png`

Use one `@changelog` line per change. The generator stores them as an array in
`scripts.json`.

The optional `@image` field appears as a thumbnail on the script card. Store
PNG previews in the repository under `images/`.

Use `@version`, `@updated`, and one or more `@changelog` lines whenever a script
changes. Affinity Hub stores the version installed through the site in the
user's browser/app storage, then shows `Update available` when the manifest
version is newer than the user's installed version.

Affinity Hub shows:

- `Recently updated` only for scripts whose `updated` date is today.
- `Update available` when a user previously installed an older version through
  Affinity Hub.
- `Installed` when the locally recorded installed version matches the manifest.

The script list keeps its main sort order by successful install count, then
title. Update badges do not change the sort order.

## Build The Site HTML

Edit the readable source in `index.pretty.html`, then minify it to `index.html`
before publishing. `index.html` is the file served by GitHub Pages.

## Community Submissions

The repository includes GitHub issue forms for:

- Script submissions
- Bug reports

Submitted scripts should be reviewed before being added to `scripts/`.

## Install Stats

The installer can display install counts when a Cloudflare Worker stats endpoint
is configured.

Worker files are in `workers/`:

```text
workers/install-stats-worker.js
workers/wrangler.example.toml
```

Deployment outline:

1. Create a Cloudflare KV namespace.
2. Copy `workers/wrangler.example.toml` to `workers/wrangler.toml`.
3. Replace the KV namespace IDs.
4. Deploy with Wrangler from the `workers/` folder.
5. Set `STATS_ENDPOINT` in `index.pretty.html` to the deployed Worker URL.
6. Regenerate the minified `index.html`.

The Worker exposes:

```text
GET /stats
POST /install
```

Install events are counted by script ID only.

This repository currently points at:

```text
https://affinity-script-installer-stats.s1m0np1.workers.dev
```

## Publish On GitHub Pages

In GitHub:

1. Open the repository settings.
2. Go to `Pages`.
3. Set `Source` to `Deploy from a branch`.
4. Choose the `main` branch and `/ (root)`.
5. Save.

## Browser And Affinity Requirements

The user must have Affinity v3.2 open with its MCP server enabled. The default
endpoint used by the page is:

```text
http://[::1]:6767/sse
```

The page also tries:

```text
https://localhost:6768/sse
http://[::1]:6767/sse
```

The HTTPS `localhost:6768` endpoint is intended for Safari users running a
local reverse proxy such as Caddy in front of Affinity's HTTP MCP server.
Affinity itself is expected to listen on IPv6 loopback at `[::1]:6767`.

When hosted on GitHub Pages, the browser connects from an HTTPS website to a
local HTTP loopback server. Affinity's MCP server must allow CORS requests and,
in some browsers, private-network preflight requests.

This is an independent project and is not affiliated with Canva, Serif, or
Affinity.
