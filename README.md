# Affinity Script Installer

A static GitHub Pages site that installs JavaScript scripts from this repository
into a user's local Affinity v3.2 script library through Affinity's built-in MCP
server.

## How It Works

1. The site loads `scripts.json`.
2. Each manifest entry points to a script file in `scripts/`.
3. The user reviews the script source in the browser.
4. The site connects to the user's local Affinity MCP server.
5. The site calls `save_script_to_library` with the script title, description,
   and source code.

No backend, package manager, build step, or Codex tooling is required.

## Publish On GitHub Pages

Create a repository under `https://github.com/S1m0nP1/`, for example:

```text
affinity-script-installer
```

Copy these files into the repository root:

```text
index.html
scripts.json
scripts/
.nojekyll
README.md
```

In GitHub:

1. Open the repository settings.
2. Go to `Pages`.
3. Set `Source` to `Deploy from a branch`.
4. Choose the `main` branch and `/ (root)`.
5. Save.

The site will be available at:

```text
https://s1m0np1.github.io/affinity-script-installer/
```

## Add Scripts

Add a JavaScript file under `scripts/`, then add an entry to `scripts.json`:

```json
{
  "id": "my-script",
  "title": "My Script",
  "description": "What the script does.",
  "path": "scripts/my-script.js",
  "tags": ["layout", "utility"]
}
```

## Browser And Affinity Requirements

The user must have Affinity v3.2 open with its MCP server enabled. The default
endpoint used by the page is:

```text
http://[::1]:6767/sse
```

The page also includes presets for:

```text
http://localhost:6767/sse
http://127.0.0.1:6767/sse
```

When hosted on GitHub Pages, the browser connects from an HTTPS website to a
local HTTP loopback server. Affinity's MCP server must allow CORS requests and,
in some browsers, private-network preflight requests.
