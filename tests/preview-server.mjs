import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
import { createFixture } from "./support.mjs";

export const startPreview = async (port = 0) => {
  const fixture = createFixture();
  const root = fileURLToPath(new URL("../public/", import.meta.url));
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === "/__test/login") {
        const role = url.searchParams.get("role");
        if (!["owner", "admin", "other", "member"].includes(role)) {
          res.writeHead(400).end();
          return;
        }
        res.writeHead(302, { "Set-Cookie": `session=test-${role}; Path=/; HttpOnly; SameSite=Lax`, Location: "/admin.html" }).end();
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const response = await fixture.handle(new Request(url, {
          method: req.method, headers: req.headers,
          ...(["GET", "HEAD"].includes(req.method) ? {} : { body }),
        }));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      let name = decodeURIComponent(url.pathname);
      if (name === "/") name = "/index.html";
      if (!extname(name)) name += ".html";
      const path = resolve(root, `.${name}`);
      if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) {
        res.writeHead(403).end();
        return;
      }
      const content = await readFile(path);
      const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif" };
      res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(content);
    } catch (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((done) => server.listen(port, "127.0.0.1", done));
  return {
    url: `http://127.0.0.1:${server.address().port}`, fixture,
    close: () => new Promise((done) => server.close(() => { fixture.sqlite.close(); done(); })),
  };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const preview = await startPreview(Number(process.env.PORT || 8788));
  console.log(`Isolated test preview: ${preview.url}/__test/login?role=owner`);
}
