import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

const banner = "/* HanuAnalytics SDK · MIT · https://github.com/madhudream/hanuanalytics */";
const common = { bundle: true, minify: true, sourcemap: false, target: ["es2020"], legalComments: "none", banner: { js: banner }, logLevel: "error" };

mkdirSync("dist", { recursive: true });

await build({ ...common, entryPoints: ["src/browser.ts"], outfile: "dist/hanu.js", format: "iife" });
await build({ ...common, entryPoints: ["src/index.ts"], outfile: "dist/hanu.esm.js", format: "esm" });
await build({ ...common, entryPoints: ["src/rec-entry.ts"], outfile: "dist/hanu-rec.js", format: "iife" });

// types: emit declarations for the ESM entry and bundle them into one file
if (existsSync("dist/types")) rmSync("dist/types", { recursive: true });
execSync("npx tsc -p tsconfig.json", { stdio: "inherit" });
const files = ["types", "index"];
let dts = "";
for (const f of files) {
  let src = readFileSync(`dist/types/${f}.d.ts`, "utf8");
  src = src.replace(/^import .*$/gm, "").replace(/^export \{\} from .*$/gm, "").replace(/^export (type )?\{[^}]*\} from "\.\/.*";$/gm, "");
  dts += `// ---- ${f} ----\n${src}\n`;
}
writeFileSync("dist/hanu.d.ts", dts);
rmSync("dist/types", { recursive: true });

for (const f of ["hanu.js", "hanu.esm.js", "hanu-rec.js"]) {
  const buf = readFileSync(`dist/${f}`);
  const gz = gzipSync(buf, { level: 9 }).length;
  console.log(`${f.padEnd(14)} ${(buf.length / 1024).toFixed(1).padStart(6)} KB   gzip ${(gz / 1024).toFixed(1).padStart(5)} KB`);
}
