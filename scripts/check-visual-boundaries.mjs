import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "@babel/parser";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
import colorNames from "color-name";

// Biome's Tailwind rules allow black/white and do not inspect inline styles.
// Restrict these specific visual escape hatches without banning dynamic geometry.
const rawColor = /(?:^|\s)(?:[^\s]*:)?!?(?:bg|text|border|ring|outline|fill|stroke|shadow|decoration|accent|caret|divide|placeholder|from|via|to)-(?:black|white)(?:\/\d+)?!?(?=$|\s)/;
const arbitraryVisual = /(?:^|\s)(?:[^\s]*:)?!?(?:(?:bg|text|rounded(?:-[trblse]{1,2})?|leading|tracking|font|shadow|border|ring|fill|stroke|outline|decoration|accent|caret|from|via|to)-\[[^\s]+|\[(?:color|background(?:-color)?|border-radius|font-size|line-height|box-shadow):[^\s]+)(?=$|\s)/;
// These stock scales exceed the type and surface sizes used by the workbench.
const oversizedVisual = /(?:^|\s)(?:[^\s]*:)?!?(?:text-[2-9]xl|rounded-(?:2xl|3xl|4xl))!?(?=$|\s)/;
const visualProperty = /^(?:color|background.*|border(?:Color|Radius|(?:Top|Right|Bottom|Left).*Color|(?:Top|Bottom)(?:Left|Right)Radius)?|outline(?:Color)?|boxShadow|textShadow|fill|stroke|opacity|font(?:Family|Size|Weight)|lineHeight|letterSpacing|textDecorationColor|--color-.*)$/;
const geometryVariables = new Set(["--sidebar-width", "--sidebar-width-icon", "--skeleton-width"]);
// Explicitly tracked existing component forwarding and form-library spreads.
// Counts prevent a new spread from silently inheriting an existing exception.
const spreadExceptions = JSON.parse(readFileSync(new URL("./visual-prop-spreads.json", import.meta.url), "utf8"));
const cssColorProperty = /^(?:--|color$|background|border|outline|box-shadow|text-shadow|fill$|stroke$|caret-color|accent-color|text-decoration-color|scrollbar-color)/i;

export function checkCss(source, filename = "input.css") {
  const root = postcss.parse(source, { from: filename });
  const errors = [];
  root.walkDecls(declaration => {
    const parent = declaration.parent;
    const theme = filename.replaceAll("\\", "/").endsWith("src/index.css") && parent.type === "rule" && [":root", ".dark"].includes(parent.selector) && declaration.prop.startsWith("--");
    if (theme || !cssColorProperty.test(declaration.prop)) return;
    let literal = false;
    valueParser(declaration.value).walk(node => {
      if (node.type === "function" && node.value.toLowerCase() === "url") return false;
      if (node.type === "function" && /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)$/i.test(node.value)) literal = true;
      if (node.type === "word" && (/^#[\da-f]{3,8}$/i.test(node.value) || Object.hasOwn(colorNames, node.value.toLowerCase()))) literal = true;
    });
    if (literal) errors.push(`${filename}:${declaration.source.start.line}:${declaration.source.start.column}: use a theme color token in CSS`);
  });
  return errors;
}

export function checkSource(source, filename = "input.tsx") {
  const file = parse(source, { sourceType: "unambiguous", plugins: ["typescript", "jsx"] });
  const errors = [];
  const remainingSpreads = { ...spreadExceptions[filename.replaceAll("\\", "/")] };
  // Resolve only unambiguous local initializers. Forwarded component props
  // are intentionally left to the receiving component's own checks.
  const bindings = new Map();
  const shadow = pattern => {
    if (!pattern) return;
    if (pattern.type === "Identifier") bindings.set(pattern.name, null);
    else if (pattern.type === "RestElement") shadow(pattern.argument);
    else if (pattern.type === "AssignmentPattern") shadow(pattern.left);
    else if (pattern.type === "ObjectPattern") pattern.properties.forEach(p => shadow(p.type === "RestElement" ? p.argument : p.value));
    else if (pattern.type === "ArrayPattern") pattern.elements.forEach(shadow);
  };
  const invalidate = target => {
    while (target?.type === "MemberExpression" || target?.type === "OptionalMemberExpression") target = target.object;
    shadow(target);
  };
  const collect = node => {
    if (!node || typeof node !== "object") return;
    if (node.type === "AssignmentExpression" || node.type === "UpdateExpression") {
      invalidate(node.type === "AssignmentExpression" ? node.left : node.argument);
    }
    if (node.type === "UnaryExpression" && node.operator === "delete") invalidate(node.argument);
    if (node.type === "CallExpression" && node.callee.type === "MemberExpression" &&
        node.callee.object.type === "Identifier" && node.callee.object.name === "Object" &&
        node.callee.property.type === "Identifier" && ["assign", "defineProperty", "defineProperties"].includes(node.callee.property.name)) {
      invalidate(node.arguments[0]);
    }
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod"].includes(node.type)) node.params.forEach(shadow);
    if (node.type === "CatchClause") shadow(node.param);
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier") {
      const name = node.id.name;
      bindings.set(name, bindings.has(name) ? null : node.init);
    } else if (node.type === "VariableDeclarator") shadow(node.id);
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "tokens", "comments", "extra"].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") collect(value);
    }
  };
  collect(file.program);
  const report = (node, message) => errors.push(`${filename}:${node.loc.start.line}:${node.loc.start.column + 1}: ${message}`);
  const checkStyle = (initial, node) => {
    let expression = initial;
    while (expression?.type === "TSAsExpression" || expression?.type === "TSSatisfiesExpression") expression = expression.expression;
    if (expression?.type === "ObjectExpression") {
      for (const property of expression.properties) {
        if (property.type === "SpreadElement" && !(filename.replaceAll("\\", "/").endsWith("src/components/ui/sidebar.tsx") && property.argument.type === "Identifier" && property.argument.name === "style"))
          report(property, "inline style spreads hide visual properties");
        const key = property.key?.name ?? property.key?.value;
        if (property.type === "ObjectProperty" && ((property.computed && property.key.type !== "StringLiteral") || (typeof key === "string" && (visualProperty.test(key) || (key.startsWith("--") && !geometryVariables.has(key))))))
          report(property, "move inline visual styling into a semantic token or shared component");
      }
    } else report(node, "use an explicit inline geometry object so visual properties can be checked");
  };
  const checkSpread = (object, seen = new Set(), origin = object) => {
    while (object?.type === "TSAsExpression" || object?.type === "TSSatisfiesExpression") object = object.expression;
    if (object?.type === "Identifier") {
      if (seen.has(object.name)) {
        report(origin, "cannot inspect recursive spread props for visual styles");
        return;
      }
      seen.add(object.name);
      return checkSpread(bindings.get(object.name), seen, origin);
    }
    if (object?.type !== "ObjectExpression") {
      const expression = source.slice(origin.start, origin.end).replace(/\s+/g, " ");
      if (remainingSpreads[expression] > 0) {
        remainingSpreads[expression]--;
      } else {
        report(origin, "cannot inspect spread props for visual styles");
      }
      return;
    }
    for (const property of object.properties) {
      if ((property.type === "ObjectProperty" || property.type === "ObjectMethod") && property.computed && property.key.type !== "StringLiteral")
        report(property, "cannot inspect computed spread props for visual styles");
      if (property.type === "ObjectMethod" && (property.key.name ?? property.key.value) === "style")
        report(property, "cannot inspect style from a spread getter");
      if (property.type === "ObjectProperty" && (!property.computed || property.key.type === "StringLiteral") && (property.key.name ?? property.key.value) === "style")
        checkStyle(property.value, property);
      if (property.type === "SpreadElement") checkSpread(property.argument, new Set(seen), property);
    }
  };
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (node.type === "StringLiteral" || node.type === "TemplateElement") {
      const value = node.value?.raw ?? node.value;
      if (rawColor.test(value)) report(node, "use a semantic color token instead of black/white utilities");
      if (arbitraryVisual.test(value)) report(node, "use a named token for visual values");
      if (oversizedVisual.test(value)) report(node, "use a supported typography or surface size");
    }
    if (node.type === "JSXAttribute" && node.name.name === "style" && node.value?.type === "JSXExpressionContainer") {
      checkStyle(node.value.expression, node);
    }
    if (node.type === "JSXSpreadAttribute") {
      checkSpread(node.argument);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "tokens" || key === "comments" || key === "extra") continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(file.program);
  return errors;
}

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sources(path) : (/\.[jt]sx?$/.test(entry.name) && !["bindings.ts", "routeTree.gen.ts"].includes(entry.name)) || path.endsWith(".css") ? [path] : [];
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const paths = process.argv.length > 2 ? process.argv.slice(2) : sources("src");
  const errors = paths.flatMap(path => (path.endsWith(".css") ? checkCss : checkSource)(readFileSync(path, "utf8"), relative(".", path)));
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
}
