import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import subsetFont from "subset-font";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/build-icon-font.mjs <MaterialSymbolsOutlined[FILL,GRAD,opsz,wght].ttf>");
  process.exit(1);
}

// Mirrors src/__tests__/fonts.test.ts collectIcons so the subset always covers
// every icon name the test shapes.
function collectIcons(source, filename, names) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
    filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function values(node) {
    if (!node) return;
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) {
      const name = node.text.trim();
      if (/^[a-z][a-z0-9_]*$/.test(name)) names.add(name);
    } else if (ts.isJsxExpression(node)) {
      values(node.expression);
    } else if (ts.isConditionalExpression(node)) {
      values(node.whenTrue);
      values(node.whenFalse);
    } else if (ts.isBinaryExpression(node)) {
      values(node.left);
      values(node.right);
    } else if (ts.isParenthesizedExpression(node)) {
      values(node.expression);
    }
  }
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.getText(tree).includes("material-symbols-outlined")) {
      node.children.forEach(values);
    }
    if ((ts.isPropertyAssignment(node) || ts.isJsxAttribute(node) || ts.isBindingElement(node))
      && node.name.getText(tree) === "icon") {
      values(node.initializer);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}

function sourceIcons() {
  const names = new Set();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory() && entry.name !== "__tests__") visit(path);
      else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        collectIcons(readFileSync(path, "utf8"), path, names);
      }
    }
  }
  visit(resolve(root, "src"));
  return [...names].sort();
}

const names = sourceIcons();
const subset = await subsetFont(readFileSync(source), names.join("\n"), { targetFormat: "woff2" });
writeFileSync(resolve(root, "public/fonts/material-symbols-outlined-subset.woff2"), subset);
console.log(`subset written: ${names.length} icon ligatures, ${subset.length} bytes`);