# Affinity Hub macOS App

This is a macOS wrapper for the Affinity Hub website. It bundles the static site
inside the app, starts a local `127.0.0.1` server while the app is open, and
loads the site in a `WKWebView`.

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
