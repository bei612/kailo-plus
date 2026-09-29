import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["src/app", "src/features", "src/shared/api"];
const extensions = new Set([".ts", ".tsx"]);
const maxLines = 1_000;
const violations = [];

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath);
    else if (extensions.has(path.extname(entry.name))) {
      const content = await fs.readFile(fullPath, "utf8");
      const lines = content ? content.split(/\r?\n/).length : 0;
      if (lines > maxLines) violations.push({ fullPath, lines });
    }
  }
}

for (const root of roots) await walk(path.join(projectRoot, root));
if (violations.length) {
  console.error(`Web file size check failed (maximum ${maxLines} lines):`);
  for (const violation of violations) {
    console.error(`- ${path.relative(projectRoot, violation.fullPath)}: ${violation.lines} lines`);
  }
  process.exit(1);
}
