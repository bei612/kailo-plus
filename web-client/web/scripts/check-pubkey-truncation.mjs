import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "src");
const expression =
  /\b[A-Za-z_$][\w$]*(?:[Pp]ubkey|[Pp]ub_key|[Nn]pub)[\w$]*\??\.(?:slice|substring)\(/g;
const allowedFiles = new Set([
  "src/shared/lib/pubkey.ts",
  "src/features/repos/ui/PubkeyAvatar.tsx",
  "src/features/repos/ui/OrgSidebar.tsx",
  "src/features/chat/ui/Avatar.tsx",
]);
const violations = [];

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath);
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      const relativePath = path.relative(projectRoot, fullPath).split(path.sep).join("/");
      if (allowedFiles.has(relativePath) || relativePath.includes(".test.")) continue;
      const lines = (await fs.readFile(fullPath, "utf8")).split("\n");
      lines.forEach((line, index) => {
        expression.lastIndex = 0;
        if (expression.test(line)) violations.push(`${relativePath}:${index + 1}`);
      });
    }
  }
}

await walk(sourceRoot);
if (violations.length) {
  console.error("Use truncatePubkey() instead of hand-rolled display truncation:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
