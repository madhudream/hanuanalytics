// Tiny static server for the demo: serves sdk/demo and sdk/dist on http://127.0.0.1:5174
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const port = Number(process.env.PORT || 5174);

createServer(async (req, res) => {
  let path = new URL(req.url || "/", "http://x").pathname;
  if (path === "/" || path.startsWith("/page/")) path = "/demo/index.html";
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`demo: http://127.0.0.1:${port}/?token=ha_pk_…  (api host http://127.0.0.1:8090)`));
