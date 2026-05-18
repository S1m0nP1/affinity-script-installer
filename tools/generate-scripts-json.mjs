import { readdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const rootDir = new URL("..", import.meta.url);
const scriptsDir = new URL("scripts/", rootDir);
const manifestUrl = new URL("scripts.json", rootDir);
const scriptExtensions = new Set([".js", ".mjs"]);
const execFileAsync = promisify(execFile);
const today = new Date().toISOString().slice(0, 10);

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

function parseTags(value) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseMetadata(source) {
  const metadata = {};
  const header = source.split(/\r?\n/).slice(0, 40);

  for (const line of header) {
    const match = line.match(/^\s*(?:\/\/|\/\*+|\*)\s*@(\w+)\s+(.+?)\s*(?:\*\/)?\s*$/);
    if (!match) continue;

    const [, key, value] = match;
    if (key === "tags") {
      metadata.tags = parseTags(value);
    } else if (key === "changelog") {
      metadata.changelog = [...(metadata.changelog || []), value.trim()];
    } else if (
      key === "id" ||
      key === "title" ||
      key === "description" ||
      key === "image" ||
      key === "author" ||
      key === "homepage" ||
      key === "github" ||
      key === "version" ||
      key === "updated" ||
      key === "affinity" ||
      key === "verified"
    ) {
      metadata[key] = value.trim();
    }
  }

  return metadata;
}

async function gitLastUpdated(scriptPath) {
  try {
    const { stdout } = await execFileAsync("git", ["log", "-1", "--format=%cs", "--", scriptPath], {
      cwd: rootDir
    });
    return stdout.trim();
  } catch (error) {
    return "";
  }
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
    .map(async (entry) => {
      const scriptPath = `scripts/${entry.name}`;
      const previous = existingByPath.get(scriptPath);
      const source = await readFile(new URL(entry.name, scriptsDir), "utf8");
      const metadata = parseMetadata(source);
      const gitUpdated = await gitLastUpdated(scriptPath);
      return {
        id: metadata.id || previous?.id || idFromFileName(entry.name),
        title: metadata.title || previous?.title || titleFromFileName(entry.name),
        description: metadata.description || previous?.description || "No description provided yet.",
        path: scriptPath,
        image: Object.hasOwn(metadata, "image") ? metadata.image : previous?.image || "",
        author: metadata.author || previous?.author || "",
        homepage: metadata.homepage || previous?.homepage || "",
        github: metadata.github || previous?.github || "",
        version: metadata.version || previous?.version || "",
        updated: metadata.updated || (gitUpdated === today ? gitUpdated : ""),
        changelog: Array.isArray(metadata.changelog)
          ? metadata.changelog
          : Array.isArray(previous?.changelog)
            ? previous.changelog
            : [],
        affinity: metadata.affinity || previous?.affinity || "",
        verified: String(metadata.verified || previous?.verified || "").toLowerCase() === "true",
        tags: Array.isArray(metadata.tags)
          ? metadata.tags
          : Array.isArray(previous?.tags)
            ? previous.tags
            : [],
        ...(previous?.translations ? { translations: previous.translations } : {})
      };
    });
  const resolvedScripts = await Promise.all(scripts);

  await writeFile(manifestUrl, `${JSON.stringify({ scripts: resolvedScripts }, null, 2)}\n`);
  console.log(`Wrote ${resolvedScripts.length} script${resolvedScripts.length === 1 ? "" : "s"} to scripts.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
