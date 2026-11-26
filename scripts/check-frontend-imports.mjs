import { readFileSync, readdirSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

const sourceRoot = new URL("../src/", import.meta.url);

function importSpecifier(node) {
  switch (node.type) {
    case "TSImportType":
      return node.source ?? node.argument;
    case "TSExternalModuleReference":
      return node.expression;
    case "CallExpression":
      return node.callee.name === "require" ? node.arguments[0] : undefined;
    default:
      return node.source;
  }
}

function resolveLocalImport(file, specifier) {
  const [path] = specifier.split(/[?#]/, 1);
  if (path.startsWith("@/")) return posix.normalize(path.slice(2));
  if (path.startsWith(".")) return posix.join(posix.dirname(file), path);
  return "";
}

export function frontendImportViolations(file, source) {
  const [layer, feature] = file.split("/");
  const tree = parse(source, {
    sourceType: "unambiguous",
    createImportExpressions: true,
    plugins: file.endsWith("x") ? ["typescript", "jsx"] : ["typescript"],
  });
  const violations = [];
  function visit(node) {
    if (!node?.type) return;
    const specifier = importSpecifier(node);
    if (specifier?.type === "StringLiteral") {
      check(specifier.value, specifier.loc.start.line);
    } else if (specifier?.type === "TemplateLiteral" && !specifier.expressions.length) {
      const path = specifier.quasis[0].value.cooked;
      if (path != null) check(path, specifier.loc.start.line);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  function check(fileName, line) {
    const target = resolveLocalImport(file, fileName);
    const [targetLayer, targetFeature] = target.split("/");
    const entry = target.replace(/\.[cm]?[jt]sx?$/, "");
    let reason;
    if ((layer === "lib" || layer === "hooks") &&
        (targetLayer === "components" || targetLayer === "routes" ||
          (layer === "lib" && targetLayer === "hooks"))) {
      reason = "crosses the dependency layers";
    } else if (layer === "components" && feature === "assistant-ui" &&
               targetLayer === "components" && targetFeature === "projects") {
      reason = "assistant-ui consumes a workspace implementation";
    } else if (!file.startsWith("lib/ai/") && entry.startsWith("lib/ai/") &&
               entry !== "lib/ai/index") {
      reason = "bypasses the public AI session entry";
    }
    if (reason) {
      violations.push(`src/${file}:${line} imports ${fileName} (${reason})`);
    }
  }
  visit(tree.program);
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = ["lib", "hooks", "components", "routes"].flatMap((layer) =>
    readdirSync(new URL(`${layer}/`, sourceRoot), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name))
      .flatMap((entry) => {
        const file = join(entry.parentPath, entry.name);
        const sourcePath = relative(fileURLToPath(sourceRoot), file)
          .split(sep)
          .join("/");
        return frontendImportViolations(sourcePath, readFileSync(file, "utf8"));
      }),
  );
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  }
}
