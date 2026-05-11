import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = new URL("..", import.meta.url);
const scriptsDir = new URL("scripts/", rootDir);
const metadataKeys = [
  "id",
  "title",
  "description",
  "image",
  "author",
  "homepage",
  "github",
  "version",
  "affinity",
  "verified",
  "tags"
];

function idFromFileName(fileName) {
  return path
    .basename(fileName, path.extname(fileName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleFromFileName(fileName) {
  return path
    .basename(fileName, path.extname(fileName))
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseHeader(source) {
  const metadata = {};
  const lines = source.split(/\r?\n/).slice(0, 80);

  for (const line of lines) {
    const match = line.match(/^\s*(?:\/\/|\/\*+|\*)\s*@(\w+)(?:\s+(.*?))?\s*(?:\*\/)?\s*$/);
    if (!match) continue;

    const [, key, value = ""] = match;
    if (metadataKeys.includes(key)) metadata[key] = value.trim();
  }

  return metadata;
}

function stripMetadataHeader(source) {
  const lines = source.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*$/.test(line)) {
      index += 1;
      continue;
    }
    if (/^\s*(?:\/\/|\/\*+|\*)\s*@\w+(?:\s+.*?)?\s*(?:\*\/)?\s*$/.test(line)) {
      index += 1;
      continue;
    }
    break;
  }

  return lines.slice(index).join("\n").replace(/^\n+/, "");
}

function buildHeader(fileName, metadata) {
  const values = {
    id: metadata.id || idFromFileName(fileName),
    title: metadata.title || titleFromFileName(fileName),
    description: metadata.description || "",
    image: metadata.image || "",
    author: metadata.author || "",
    homepage: metadata.homepage || "",
    github: metadata.github || "",
    version: metadata.version || "",
    affinity: metadata.affinity || "",
    verified: metadata.verified || "",
    tags: metadata.tags || ""
  };

  return `${metadataKeys.map((key) => `// @${key} ${values[key]}`).join("\n")}\n\n`;
}

async function main() {
  const entries = await readdir(scriptsDir, { withFileTypes: true });
  const scripts = entries
    .filter((entry) => entry.isFile() && [".js", ".mjs"].includes(path.extname(entry.name)))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of scripts) {
    const fileUrl = new URL(entry.name, scriptsDir);
    let source = await readFile(fileUrl, "utf8");
    const bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
    if (bom) source = source.slice(1);

    const metadata = parseHeader(source);
    const body = stripMetadataHeader(source);
    await writeFile(fileUrl, bom + buildHeader(entry.name, metadata) + body, "utf8");
  }

  console.log(`Normalized metadata headers in ${scripts.length} script files.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
