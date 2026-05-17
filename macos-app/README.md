# Affinity Hub macOS App

This is a macOS wrapper for the Affinity Hub website. It starts a local
`127.0.0.1` server while the app is open and loads that local origin in a
`WKWebView`, which keeps Affinity MCP localhost connections working.

For each site file, the local server first fetches the latest version from
`https://affinityhub.js.org/` with no-cache headers so published website changes
are visible after reload. If the live website cannot be reached, it falls back
to the bundled static copy inside the app.

The local server is internal to the app. Users do not need to start it manually,
and it stops when the app quits.

## Build A Universal App

From this folder:

```sh
./package-universal.sh
```

The script builds both Apple Silicon and Intel slices, merges them with `lipo`,
adds the app icon, copies the bundled site files, signs the app ad hoc, and
creates:

- `dist/Affinity Hub.app`
- `dist/AffinityHub-macOS-universal.zip`
- `dist/AffinityHub-macOS-universal.dmg`

## Notes

Local builds are not notarized. For public distribution, sign the app with a
Developer ID certificate and notarize the DMG.
