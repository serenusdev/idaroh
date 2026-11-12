import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { create, type Font } from "@pdf-lib/fontkit";
import postcss from "postcss";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const css = postcss.parse(readFileSync(resolve(root, "src/app/globals.css"), "utf8"));
const font = (name: string) => create(readFileSync(resolve(root, "public/fonts", name)));
type VariableFont = Font & {
  variationAxes: Record<string, { min: number; default: number; max: number }>;
};

// Inspect rendered ligatures, conditional result branches, icon props/defaults,
// and icon data maps (not just static JSX). New names must shape in the subset.
function collectIcons(source: string, filename: string, names: Set<string>) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
    filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function values(node: ts.Node | undefined) {
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
  function visit(node: ts.Node) {
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
  const names = new Set<string>();
  function visit(directory: string) {
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

const symbols = font("material-symbols-outlined-subset.woff2") as VariableFont;

describe("self-hosted fonts and zoom", () => {
  it("does not restrict zoom or load remote font stylesheets", () => {
    const layout = readFileSync(resolve(root, "src/app/layout.tsx"), "utf8");
    expect(layout).not.toMatch(/\b(maximumScale|userScalable)\s*:/);
    expect(layout).not.toMatch(/fonts\.(googleapis|gstatic)\.com|next\/font\/google/);
    expect(layout).toMatch(/initialScale:\s*1/);
    expect(readFileSync(resolve(root, "middleware.ts"), "utf8")).toContain("fonts/");
  });

  it("keeps brand tokens and serves real local WOFF2 faces with swap", () => {
    const faces: postcss.AtRule[] = [];
    css.walkAtRules("font-face", (rule) => { faces.push(rule); });
    expect(faces).toHaveLength(6);
    for (const face of faces) {
      const declarations = new Map<string, string>();
      face.walkDecls((decl) => { declarations.set(decl.prop, decl.value); });
      expect(declarations.get("font-display")).toBe("swap");
      expect(declarations.get("font-style")).toBe("normal");
      const src = declarations.get("src")!;
      expect(src).toMatch(/^url\("\/fonts\/[\w-]+\.woff2"\) format\("woff2"\)$/);
      const asset = src.match(/url\("([^"]+)"\)/)![1];
      expect(readFileSync(resolve(root, `public${asset}`)).subarray(0, 4).toString()).toBe("wOF2");
    }
    const text = css.toString();
    expect(text).toContain('--font-hanken-grotesk: "Hanken Grotesk"');
    expect(text).toContain('--font-ibm-plex-mono: "IBM Plex Mono"');
    expect(text).not.toMatch(/\b(size-adjust|ascent-override|descent-override|line-gap-override)\s*:/);
  });

  it("provides the actual brand weights and upstream licenses", () => {
    const hanken = font("hanken-grotesk-latin-variable.woff2") as VariableFont;
    expect(hanken.familyName).toBe("Hanken Grotesk");
    expect(hanken.variationAxes.wght).toMatchObject({ min: 100, max: 900 });
    expect(hanken.layout("IDAROH 0123456789 — Fájar").glyphs.every((glyph) => glyph.id !== 0)).toBe(true);
    for (const weight of [400, 500, 600, 700]) {
      const mono = font(`ibm-plex-mono-latin-${weight}.woff2`) as Font & { "OS/2": { usWeightClass: number } };
      expect(mono.familyName).toMatch(/^IBM Plex Mono/);
      expect(mono["OS/2"].usWeightClass).toBe(weight);
      expect(mono.layout("IDAROH 0123456789 — Fájar").glyphs.every((glyph) => glyph.id !== 0)).toBe(true);
    }
    for (const license of ["Hanken-Grotesk-OFL.txt", "IBM-Plex-Mono-OFL.txt"]) {
      expect(readFileSync(resolve(root, "public/fonts", license), "utf8")).toContain("SIL OPEN FONT LICENSE Version 1.1");
    }
    expect(readFileSync(resolve(root, "public/fonts/Material-Symbols-Outlined-LICENSE.txt"), "utf8"))
      .toContain("Apache License");
  });

  it("collects dynamic result branches, navigation maps and component defaults", () => {
    const names = new Set<string>();
    collectIcons(`
      const items = [{ icon: "backup" }];
      function Example({ icon = "inbox" }) {
        return <><span className="material-symbols-outlined">{kind === "success" ? "check_circle" : "error"}</span>
          <Badge icon="alarm" /><span className="material-symbols-outlined">{item.icon}</span></>;
      }
    `, "fixture.tsx", names);
    expect([...names].sort()).toEqual(["alarm", "backup", "check_circle", "error", "inbox"]);
  });

  it("shapes every source icon into a single non-missing glyph", () => {
    const names = sourceIcons();
    expect(names.length).toBeGreaterThan(100);
    expect(names).toEqual(expect.arrayContaining(["dashboard", "backup", "inbox", "diversity_3", "notifications_active"]));
    for (const name of names) {
      const glyphs = symbols.layout(name).glyphs;
      expect(glyphs, `Missing ligature: ${name}`).toHaveLength(1);
      expect(glyphs[0].id, `Missing glyph: ${name}`).not.toBe(0);
    }
  });

  it("retains FILL 0..1 and the original axes without overriding size utilities", () => {
    expect(symbols.familyName).toBe("Material Symbols Outlined");
    expect(symbols.variationAxes).toMatchObject({
      FILL: { min: 0, default: 0, max: 1 },
      wght: { min: 100, default: 400, max: 700 },
      GRAD: { min: -50, default: 0, max: 200 },
      opsz: { min: 20, default: 24, max: 48 },
    });
    const rules: postcss.Rule[] = [];
    css.walkRules(".material-symbols-outlined", (rule) => { rules.push(rule); });
    expect(rules).toHaveLength(1);
    expect((rules[0].parent as postcss.AtRule).params).toBe("base");
    const declarations = new Map<string, string>();
    rules[0].walkDecls((decl) => { declarations.set(decl.prop, decl.value); });
    expect(declarations.get("font-family")).toBe('"Material Symbols Outlined"');
    expect(declarations.get("font-feature-settings")).toBe('"liga"');
    expect(declarations.get("font-variation-settings")).toBe('"FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24');
    expect(rules[0].toString()).not.toContain("!important");
  });
});
