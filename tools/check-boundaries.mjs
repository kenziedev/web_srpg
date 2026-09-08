import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : [join(dir, entry.name)],
  );
}
const errors = [];
for (const file of files("packages/core/src").filter(
  (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
)) {
  const source = readFileSync(file, "utf8");
  if (
    /\b(?:document|window|localStorage|indexedDB)\s*\.|\b(?:Math\.random|Date\.now|fetch)\s*\(/.test(
      source,
    )
  )
    errors.push(`${file}: browser, clock, network or random API in core`);
  for (const match of source.matchAll(
    /(?:from\s*|import\s*\()['"]([^'"]+)['"]/g,
  )) {
    if (!match[1].startsWith("./") && match[1] !== "@orden/schema")
      errors.push(`${file}: forbidden dependency ${match[1]}`);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "Core boundary check passed. This static guard supplements code review.",
  );
