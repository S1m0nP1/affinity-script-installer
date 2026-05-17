#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
REPO_ROOT=${SCRIPT_DIR:h}
APP_ROOT="$SCRIPT_DIR/dist/Affinity Hub.app"
ARM_BIN="$SCRIPT_DIR/.build/arm64-apple-macosx/release/AffinityHubMac"
X86_BIN="$SCRIPT_DIR/.build/x86_64-apple-macosx/release/AffinityHubMac"

cd "$SCRIPT_DIR"

swift build -c release --triple arm64-apple-macosx13.0
swift build -c release --triple x86_64-apple-macosx13.0

rm -rf "$APP_ROOT"
mkdir -p "$APP_ROOT/Contents/MacOS" "$APP_ROOT/Contents/Resources/site"

lipo -create "$ARM_BIN" "$X86_BIN" -output "$APP_ROOT/Contents/MacOS/AffinityHub"
chmod +x "$APP_ROOT/Contents/MacOS/AffinityHub"

cp "$REPO_ROOT/index.html" "$APP_ROOT/Contents/Resources/site/index.html"
cp "$REPO_ROOT/scripts.json" "$APP_ROOT/Contents/Resources/site/scripts.json"
cp "$REPO_ROOT/favicon.ico" "$APP_ROOT/Contents/Resources/site/favicon.ico"
cp "$REPO_ROOT/site.webmanifest" "$APP_ROOT/Contents/Resources/site/site.webmanifest"
cp -R "$REPO_ROOT/scripts" "$APP_ROOT/Contents/Resources/site/scripts"
cp -R "$REPO_ROOT/images" "$APP_ROOT/Contents/Resources/site/images"
cp -R "$REPO_ROOT/assets" "$APP_ROOT/Contents/Resources/site/assets"
cp "$SCRIPT_DIR/Resources/AffinityHub.icns" "$APP_ROOT/Contents/Resources/AffinityHub.icns"

/usr/libexec/PlistBuddy -c "Clear dict" "$APP_ROOT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string AffinityHub" "$APP_ROOT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string org.affinityhub.mac.web" "$APP_ROOT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleName string AffinityHub" "$APP_ROOT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string Affinity Hub" "$APP_ROOT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string AffinityHub" "$APP_ROOT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundlePackageType string APPL" "$APP_ROOT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string 0.3.11" "$APP_ROOT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleVersion string 14" "$APP_ROOT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :LSMinimumSystemVersion string 13.0" "$APP_ROOT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :NSHighResolutionCapable bool true" "$APP_ROOT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :NSLocalNetworkUsageDescription string Affinity Hub connects to the local Affinity MCP server to install scripts." "$APP_ROOT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity dict" "$APP_ROOT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true" "$APP_ROOT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSAllowsArbitraryLoadsInWebContent bool true" "$APP_ROOT/Contents/Info.plist"

plutil -lint "$APP_ROOT/Contents/Info.plist"
codesign --force --deep --sign - "$APP_ROOT"

cd "$SCRIPT_DIR/dist"
rm -f AffinityHub-macOS-universal.zip AffinityHub-macOS-universal.dmg
ditto -c -k --keepParent "Affinity Hub.app" AffinityHub-macOS-universal.zip
hdiutil create -volname "Affinity Hub" -srcfolder "Affinity Hub.app" -ov -format UDZO AffinityHub-macOS-universal.dmg

lipo -archs "$APP_ROOT/Contents/MacOS/AffinityHub"
codesign --verify --deep --strict --verbose=2 "$APP_ROOT"
