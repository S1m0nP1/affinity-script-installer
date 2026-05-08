# Affinity Script Installer
https://s1m0np1.github.io/affinity-script-installer/

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
