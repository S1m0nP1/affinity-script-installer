import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = new URL("..", import.meta.url);
const scriptsDir = new URL("scripts/", rootDir);
const manifestUrl = new URL("scripts.json", rootDir);
const scriptExtensions = new Set([".js", ".mjs"]);

function titleFromFileName(fileName) {
  return path
    .basename(fileName, path.extname(fileName))
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function idFromFileName(fileName) {
  return path
    .basename(fileName, path.extname(fileName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function readExistingManifest() {
  try {
    const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
    return Array.isArray(manifest.scripts) ? manifest.scripts : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function main() {
  const existing = await readExistingManifest();
  const existingByPath = new Map(existing.map((script) => [script.path, script]));
  const entries = await readdir(scriptsDir, { withFileTypes: true });

  const scripts = entries
    .filter((entry) => entry.isFile() && scriptExtensions.has(path.extname(entry.name)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const scriptPath = `scripts/${entry.name}`;
      const previous = existingByPath.get(scriptPath);
      return {
        id: previous?.id || idFromFileName(entry.name),
        title: previous?.title || titleFromFileName(entry.name),
        description: previous?.description || "No description provided yet.",
        path: scriptPath,
        tags: Array.isArray(previous?.tags) ? previous.tags : []
      };
    });

  await writeFile(manifestUrl, `${JSON.stringify({ scripts }, null, 2)}\n`);
  console.log(`Wrote ${scripts.length} script${scripts.length === 1 ? "" : "s"} to scripts.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
