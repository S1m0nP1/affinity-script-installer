# AffinityHub Mac Test App

This is a small macOS-only prototype for testing whether AffinityHub works
better as a local app than as a browser-only GitHub Pages site.

It is intentionally simple:

- loads the live `scripts.json` catalog from `https://affinityhub.js.org/`
- previews selected script source
- connects to Affinity's local MCP endpoint
- installs the selected script with `save_script_to_library`

## Run

From this folder:

```sh
swift run
```

Then:

1. Open Affinity v3.2 or newer.
2. Make sure Affinity MCP/server support is enabled.
3. Click **Load Catalog**.
4. Click **Connect to Affinity**.
5. Select a script and click **Install Selected**.

## Why This Helps

The desktop app connects directly from the local machine, so it avoids the main
browser-only problems: GitHub Pages HTTPS to local HTTP, private-network browser
prompts, CORS, and Safari restrictions.

This prototype is not signed, notarized, sandboxed, or packaged yet. It is just a
proof-of-concept for the AffinityHub connection flow.
