// Regenerates public/fonts/material-symbols-outlined-subset.woff2 from the upstream Material
// Symbols variable font, keeping only the icon names this app can render.
//
//   node scripts/subset-material-icons.mjs            # rewrite the shipped subset
//   node scripts/subset-material-icons.mjs --check     # report drift without writing
//   node scripts/subset-material-icons.mjs --names     # print the icon names it will retain
//   node scripts/subset-material-icons.mjs --master ./local-copy.woff2
//
// The master is not served and not committed: it is fetched once into .cache/material-symbols/
// and pinned by SHA-256 below, so an upstream change cannot silently reshape the shipped file.
//
// Harfbuzz runs with NO_LAYOUT_CLOSURE and no feature restriction: layout closure would pull every
// ligature output glyph back in (reproducing the ~4 MB master), while the default "retain all
// features" setting keeps the liga rules that make "dashboard" shape. hb_subset_input_set() with the
// index subset-font passes for LAYOUT_FEATURE_TAG resolves to the unicode set in harfbuzzjs 1.6.4, so
// it is a no-op here and the pin APIs (_hb_subset_input_pin_axis_to_default,
// _hb_subset_input_pin_axis_location) fault the wasm heap; all four axes therefore stay at full range.

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { create } = require("@pdf-lib/fontkit");
const fontverter = require("fontverter");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(root, "public/fonts/material-symbols-outlined-subset.woff2");
const MASTER_URL = "https://fonts.gstatic.com/s/materialsymbolsoutlined/v387/kJEhBvYX7BgnkSrUwT8OhrdQw4oELdPIeeII9v6oFsI.woff2";
const MASTER_SHA256 = "632a98f65389d16fa46d925092888d5bd3e0c4b7376da4bad74c398de6bd544f";
const MASTER_CACHE = join(root, ".cache/material-symbols/material-symbols-outlined-v387.woff2");
// Matches the gate in src/__tests__/fonts.test.ts: the four axes cannot be narrowed without a design
// decision, and 151 icons at full axis range measure 122.864 bytes.
const SIZE_BUDGET = 140 * 1024;
const BASE_GLYPH_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789_-";
const HB_SUBSET_FLAGS_RETAIN_GLYPH_NAMES = 0x00000080;
const HB_SUBSET_FLAGS_NO_LAYOUT_CLOSURE = 0x00000200;

const args = process.argv.slice(2);
const masterFlag = args.indexOf("--master");
const checkOnly = args.includes("--check");

function walk(directory, matches) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path, matches));
    else if (matches(entry.name)) files.push(path);
  }
  return files;
}

const shaped = new Map();
function ligatureId(font, name) {
  if (!shaped.has(name)) {
    const glyphs = font.layout(name).glyphs;
    shaped.set(name, glyphs.length === 1 && glyphs[0].id !== 0 ? glyphs[0].id : 0);
  }
  return shaped.get(name);
}

function isIconKey(name) {
  return name && ts.isIdentifier(name) && /icon$/i.test(name.text);
}

// Superset of the collector in src/__tests__/fonts.test.ts: that one matches the exact key
// "icon", this also accepts activeIcon / fallbackIcon / categoryIcon so a nav or status map
// cannot introduce a name the subset does not carry.
function collectSourceIcons(source, filename, names) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
    filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const add = (node) => {
    if (!node) return;
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) {
      const name = node.text.trim();
      if (/^[a-z][a-z0-9_]*$/.test(name)) names.add(name);
    } else if (ts.isJsxExpression(node)) add(node.expression);
    else if (ts.isConditionalExpression(node)) { add(node.whenTrue); add(node.whenFalse); }
    else if (ts.isBinaryExpression(node)) { add(node.left); add(node.right); }
    else if (ts.isParenthesizedExpression(node)) add(node.expression);
    else if (ts.isArrayLiteralExpression(node)) node.elements.forEach(add);
    else if (ts.isObjectLiteralExpression(node)) node.properties.forEach(add);
    else if (ts.isPropertyAssignment(node)) add(node.initializer);
  };
  const visit = (node) => {
    if (ts.isJsxElement(node) && /material-symbols-outlined/.test(node.openingElement.getText(tree))) {
      node.children.forEach(add);
    }
    if (ts.isPropertyAssignment(node) && isIconKey(node.name)) add(node.initializer);
    if (ts.isBindingElement(node) && isIconKey(node.name)) add(node.initializer);
    if (ts.isJsxAttribute(node) && isIconKey(node.name)) add(node.initializer?.value ?? node.initializer?.expression);
    ts.forEachChild(node, visit);
  };
  visit(tree);
}

// Icons that reach the DOM from database rows instead of source, e.g. report_categories.icon.
function collectSeededIcons(names) {
  for (const file of walk(join(root, "supabase/migrations"), (name) => name.endsWith(".sql"))) {
    const sql = readFileSync(file, "utf8");
    for (const match of sql.matchAll(/\bicon\s+(?:text\s+)?(?:DEFAULT|NOT NULL DEFAULT)\s+'([a-z0-9_]+)'/g)) {
      names.add(match[1]);
    }
    for (const insert of sql.matchAll(/INSERT INTO public\.(\w+) \(([^)]*\bicon\b[^)]*)\) VALUES([\s\S]*?);/g)) {
      const index = insert[2].split(",").map((column) => column.trim()).indexOf("icon");
      for (const tuple of insert[3].matchAll(/\(([^)]*)\)/g)) {
        const value = tuple[1].split(",")[index]?.trim();
        const quoted = value?.match(/^'([a-z0-9_]+)'$/);
        if (quoted) names.add(quoted[1]);
      }
    }
  }
}

async function loadMaster() {
  if (masterFlag >= 0) {
    const path = resolve(args[masterFlag + 1]);
    return { buffer: readFileSync(path), origin: relative(root, path) };
  }
  if (!existsSync(MASTER_CACHE)) {
    mkdirSync(dirname(MASTER_CACHE), { recursive: true });
    const response = await fetch(MASTER_URL);
    if (!response.ok) throw new Error(`master download failed: HTTP ${response.status} ${MASTER_URL}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(MASTER_CACHE, buffer);
  }
  return { buffer: readFileSync(MASTER_CACHE), origin: `${MASTER_URL} (cached at ${relative(root, MASTER_CACHE)})` };
}

const { buffer: master, origin } = await loadMaster();
const checksum = createHash("sha256").update(master).digest("hex");
if (checksum !== MASTER_SHA256) {
  throw new Error(`master checksum mismatch\n  expected ${MASTER_SHA256}\n  actual   ${checksum}\n  source   ${origin}`);
}

const font = create(master);
const sourceNames = new Set();
for (const file of walk(join(root, "src"), (name) => /\.tsx?$/.test(name))) {
  collectSourceIcons(readFileSync(file, "utf8"), file, sourceNames);
}
const seedNames = new Set();
collectSeededIcons(seedNames);

const candidateNames = new Set([...sourceNames, ...seedNames]);
const iconNames = [...candidateNames].filter((name) => ligatureId(font, name) !== 0).sort();
// A name this app renders that upstream no longer ships cannot be subsetted in, so it has to
// stop the build here instead of surfacing later as raw ligature text in the browser.
// Names the broad scanner matched that upstream does not ship are mostly non-icon strings, so
// they warn here; src/__tests__/fonts.test.ts is the gate that a used icon is actually missing.
const unshipped = [...sourceNames].filter((name) => ligatureId(font, name) === 0).sort();

if (args.includes("--names")) {
  console.log(iconNames.join("\n"));
  process.exit(0);
}

if (checkOnly) {
  const shipped = create(readFileSync(OUTPUT));
  const stale = iconNames.filter((name) => ligatureId(shipped, name) === 0);
  console.log(`shipped  ${statSync(OUTPUT).size} bytes, ${shipped.numGlyphs} glyphs, ${iconNames.length} icon names`);
  if (stale.length) throw new Error(`subset is stale, missing: ${stale.join(", ")}`);
  console.log("subset is current for the names found in src and migrations");
  process.exit(0);
}

const { instance: { exports: hb } } = await WebAssembly.instantiate(
  readFileSync(require.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm")));
hb._initialize();
const heap = () => new Uint8Array(hb.memory.buffer);

const truetype = Buffer.from(await fontverter.convert(master, "truetype"));
const input = hb.hb_subset_input_create_or_fail();
hb.hb_subset_input_set_flags(input, hb.hb_subset_input_get_flags(input)
  | HB_SUBSET_FLAGS_NO_LAYOUT_CLOSURE | HB_SUBSET_FLAGS_RETAIN_GLYPH_NAMES);
const glyphSet = hb.hb_subset_input_glyph_set(input);
for (const name of iconNames) hb.hb_set_add(glyphSet, ligatureId(font, name));
// Ligatures fire only when the browser can map each letter first, so the base glyph cmap stays.
const unicodes = hb.hb_subset_input_unicode_set(input);
hb.hb_set_clear(unicodes);
for (const ch of BASE_GLYPH_CHARS) hb.hb_set_add(unicodes, ch.codePointAt(0));

const pointer = hb.malloc(truetype.length);
heap().set(new Uint8Array(truetype), pointer);
const blob = hb.hb_blob_create(pointer, truetype.length, 2, 0, 0);
const face = hb.hb_face_create(blob, 0);
hb.hb_blob_destroy(blob);
const subset = hb.hb_subset_or_fail(face, input);
if (!subset) throw new Error("harfbuzz returned a null subset");
const result = hb.hb_face_reference_blob(subset);
const offset = hb.hb_blob_get_data(result, 0);
const length = hb.hb_blob_get_length(result);
const subsetTtf = Buffer.from(heap().subarray(offset, offset + length));
hb.hb_blob_destroy(result);
hb.hb_face_destroy(subset);
hb.hb_face_destroy(face);
hb.hb_subset_input_destroy(input);
hb.free(pointer);

const woff2 = Buffer.from(await fontverter.convert(subsetTtf, "woff2", "truetype"));
const built = create(woff2);
const lost = iconNames.filter((name) => ligatureId(built, name) === 0);
if (lost.length) throw new Error(`subset lost ligatures for: ${lost.join(", ")}`);
const seedOnly = iconNames.filter((name) => !sourceNames.has(name));
console.log(`master   ${master.length} bytes, ${font.numGlyphs} glyphs, ${font.name.records.version.en}`);
console.log(`         ${origin}`);
console.log(`subset   ${woff2.length} bytes, ${built.numGlyphs} glyphs, ${(100 - woff2.length / master.length * 100).toFixed(1)}% smaller`);
console.log(`axes     ${Object.keys(built.variationAxes).join(", ")}`);
console.log(`icons    ${iconNames.length} (${sourceNames.size} from src, ${seedOnly.length} seed-only: ${seedOnly.join(", ")})`);
console.log(`dropped  ${candidateNames.size - iconNames.length} candidates upstream does not ship`);
if (unshipped.length) console.log(`warning  ${unshipped.length} src string(s) matched an icon key but have no ligature: ${unshipped.join(", ")}`);
writeFileSync(OUTPUT, woff2);
console.log(`wrote    ${relative(root, OUTPUT)}`);
if (woff2.length >= SIZE_BUDGET) {
  throw new Error(`subset is ${woff2.length} bytes, over the ${SIZE_BUDGET} byte budget`);
}
