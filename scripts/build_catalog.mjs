import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const SYSTEMS_DIR = path.join(REPO_ROOT, "systems");
const CATALOG_DIR = path.join(REPO_ROOT, "catalog");
const CATALOG_PATH = path.join(CATALOG_DIR, "catalog.json");
const README_PATH = path.join(REPO_ROOT, "README.md");

const AUTO_START = "<!-- CATALOG:START -->";
const AUTO_END = "<!-- CATALOG:END -->";

function exists(filePath) {
  return fs.existsSync(filePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeSlugFromFolder(folderName) {
  const valid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(folderName);

  assert(
    valid,
    `Invalid system folder name "${folderName}". Use lowercase letters, numbers, and hyphens only.`
  );

  return folderName;
}

function normalizeDescription(description) {
  if (typeof description === "string") {
    return {
      short: description.trim(),
      long: "",
    };
  }

  if (description && typeof description === "object") {
    return {
      short: cleanString(description.short),
      long: cleanString(description.long),
    };
  }

  return {
    short: "",
    long: "",
  };
}

function normalizeAuthors(meta) {
  if (typeof meta.author === "string" && meta.author.trim()) {
    return [meta.author.trim()];
  }

  if (!Array.isArray(meta.authors)) {
    return [];
  }

  return meta.authors
    .map((author) => {
      if (typeof author === "string") return author.trim();

      if (author && typeof author === "object") {
        return cleanString(author.name);
      }

      return "";
    })
    .filter(Boolean);
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .map((tag) => {
      if (typeof tag === "string") return tag.trim();

      if (tag && typeof tag === "object") {
        return cleanString(tag.value);
      }

      return "";
    })
    .filter(Boolean);
}

function normalizeLicense(license) {
  if (typeof license === "string") {
    return license.trim();
  }

  if (license && typeof license === "object") {
    return cleanString(license.value);
  }

  return "";
}

function resolveSystemFile(slug, sysDir, value, fallback) {
  const raw = cleanString(value) || fallback;

  const relative = raw
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    .replace(new RegExp(`^${slug}/`), "");

  const localPath = path.join(sysDir, relative);

  assert(
    exists(localPath),
    `Missing required file: ${toPosix(path.relative(REPO_ROOT, localPath))}`
  );

  return toPosix(path.join("systems", slug, relative));
}

function buildSystemsIndex() {
  assert(exists(SYSTEMS_DIR), "Missing systems/ folder.");

  const folders = fs
    .readdirSync(SYSTEMS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const systems = [];

  for (const folder of folders) {
    const slug = safeSlugFromFolder(folder);
    const sysDir = path.join(SYSTEMS_DIR, slug);

    const aggregationPath = path.join(sysDir, "aggregation.json");
    const metaPath = path.join(sysDir, "meta.json");

    assert(
      exists(aggregationPath),
      `Missing required file: systems/${slug}/aggregation.json`
    );

    assert(
      exists(metaPath),
      `Missing required file: systems/${slug}/meta.json`
    );

    const meta = readJson(metaPath);

    const description = normalizeDescription(meta.description);
    const authors = normalizeAuthors(meta);
    const tags = normalizeTags(meta.tags);
    const license = normalizeLicense(meta.license);

    const name = cleanString(meta.title) || cleanString(meta.name) || slug;

    const thumbnail = resolveSystemFile(
      slug,
      sysDir,
      meta.files?.thumbnail,
      "00_thumb.png"
    );

    systems.push({
      slug,
      name,
      description: description.short,
      description_long: description.long,
      tags,
      license,
      author: authors.join(", "),
      authors,
      thumbnail,
      aggregation_url: `systems/${slug}/aggregation.json`,
      meta_url: `systems/${slug}/meta.json`,
    });
  }

  return systems;
}

function writeCatalog(systems) {
  fs.mkdirSync(CATALOG_DIR, { recursive: true });

  const catalog = {
    generated_at: new Date().toISOString(),
    count: systems.length,
    systems,
  };

  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n");
}

function escapeMd(text) {
  return String(text ?? "").replace(/\|/g, "\\|").trim();
}

function buildRootReadmeSection(systems) {
  if (systems.length === 0) {
    return `${AUTO_START}
<!-- This section is automatically generated. Do not edit manually. -->

No systems available yet.

${AUTO_END}`;
  }

  const rows = systems
    .map((system) => {
      const thumbnail = `![${escapeMd(system.name)}](${system.thumbnail})`;
      const name = `[${escapeMd(system.name)}](systems/${system.slug}/)`;
      const author = escapeMd(system.author || "Unknown");
      const description = escapeMd(system.description || "");
      const files = `[aggregation.json](${system.aggregation_url}) · [meta.json](${system.meta_url})`;

      return `| ${thumbnail} | ${name}<br><br>${description}<br><br>by ${author}<br>${files} |`;
    })
    .join("\n");

  return `${AUTO_START}
<!-- This section is automatically generated. Do not edit manually. -->

| Preview | System |
|---|---|
${rows}

${AUTO_END}`;
}

function updateRootReadme(systems) {
  assert(exists(README_PATH), "Missing root README.md.");

  const readme = fs.readFileSync(README_PATH, "utf8");

  const start = readme.indexOf(AUTO_START);
  const end = readme.indexOf(AUTO_END);

  assert(
    start !== -1 && end !== -1 && end > start,
    `README markers not found. Add ${AUTO_START} and ${AUTO_END}.`
  );

  const before = readme.slice(0, start);
  const after = readme.slice(end + AUTO_END.length);

  const generatedSection = buildRootReadmeSection(systems);

  fs.writeFileSync(
    README_PATH,
    `${before}${generatedSection}${after}`.replace(/\n{3,}/g, "\n\n")
  );
}

function buildSystemReadme(system) {
  const description = [
    system.description || "_No short description provided._",
    system.description_long || "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const tags =
    system.tags.length > 0
      ? system.tags.map((tag) => `\`${tag}\``).join(" ")
      : "_No tags_";

  return `# ${system.name}

![${system.name}](00_thumb.png)

## Description

${description}

## Information

| Field | Value |
|---|---|
| Slug | \`${system.slug}\` |
| Author | ${system.author || "_Unknown author_"} |
| License | ${system.license || "_No license specified_"} |
| Tags | ${tags} |

## Files

- [aggregation.json](aggregation.json)
- [meta.json](meta.json)

---

This README was generated automatically from \`meta.json\` by \`scripts/build_catalog.mjs\`.
`;
}

function writeSystemReadmes(systems) {
  for (const system of systems) {
    const readmePath = path.join(SYSTEMS_DIR, system.slug, "README.md");
    fs.writeFileSync(readmePath, buildSystemReadme(system));
  }
}

const systems = buildSystemsIndex();

writeCatalog(systems);
updateRootReadme(systems);
writeSystemReadmes(systems);

console.log(
  `Generated catalog/catalog.json, root README.md, and ${systems.length} system README file(s).`
);
