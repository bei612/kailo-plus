import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "src");
const userFacingAttributes = new Set(["aria-label", "placeholder", "title"]);
const allowedJsxText = new Set(["Buzz", "README", "⌘K", "&middot;"]);
const violations = [];

function hasWords(value) {
  return /[A-Za-z\u3400-\u9fff]/u.test(value);
}

function normalize(value) {
  return value.replace(/\s+/g, " ").trim();
}

function report(file, sourceFile, node, value) {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  violations.push({
    file: path.relative(projectRoot, file),
    line: location.line + 1,
    value: normalize(value),
  });
}

function inspect(file, content) {
  const sourceFile = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  function visit(node) {
    if (ts.isJsxText(node)) {
      const value = normalize(node.getText(sourceFile));
      if (hasWords(value) && !allowedJsxText.has(value)) report(file, sourceFile, node, value);
    }

    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isStringLiteral(node.expression) || ts.isNoSubstitutionTemplateLiteral(node.expression))
    ) {
      const value = normalize(node.expression.text);
      if (hasWords(value) && !allowedJsxText.has(value)) report(file, sourceFile, node, value);
    }

    if (ts.isJsxAttribute(node) && userFacingAttributes.has(node.name.getText(sourceFile))) {
      const initializer = node.initializer;
      if (initializer && ts.isStringLiteral(initializer)) {
        const value = normalize(initializer.text);
        if (hasWords(value)) report(file, sourceFile, node, value);
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(sourceFile) === "toast" &&
      node.arguments[0] &&
      (ts.isStringLiteral(node.arguments[0]) ||
        ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
    ) {
      report(file, sourceFile, node.arguments[0], node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(target);
    else if (entry.name.endsWith(".tsx")) inspect(target, await fs.readFile(target, "utf8"));
  }
}

await walk(sourceRoot);

if (violations.length) {
  console.error("Internationalization check failed. Route application-owned UI copy through t():");
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line}: ${JSON.stringify(violation.value)}`);
  }
  process.exit(1);
}
