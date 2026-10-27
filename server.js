// RoamPlan server: serves static files and builds itineraries from open data (see planner.js).
// Zero dependencies. Needs Node 18+.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { plan } = require("./planner");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DIST = path.join(ROOT, "dist"); // built by `npm run build`
const TYPES = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml",
  ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 20000) req.destroy(); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const send = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/itinerary") {
      const input = JSON.parse(await readBody(req));
      if (!Array.isArray(input.places) || !input.places.length || !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate || ""))
        return send(res, 400, { error: "Please provide places and a start date." });
      input.places = input.places.slice(0, 6).map((p) => String(p).trim().slice(0, 80)).filter(Boolean);
      input.days = Math.min(Math.max(parseInt(input.days) || 3, 1), 14);
      input.travellers = Math.min(Math.max(parseInt(input.travellers) || 1, 1), 200);
      input.interests = String(input.interests || "").slice(0, 300);
      return send(res, 200, await plan(input));
    }
    // Static files from dist/, with index.html as the fallback for the single-page app.
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    let file = path.join(DIST, rel);
    if (!file.startsWith(DIST + path.sep) && file !== DIST) { res.writeHead(403); return res.end("Forbidden"); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(503); return res.end("Frontend not built. Run: npm run build"); }
    const ext = path.extname(file);
    res.writeHead(200, {
      "content-type": (TYPES[ext] || "application/octet-stream") + (ext === ".html" || ext === ".css" || ext === ".js" ? "; charset=utf-8" : ""),
      "cache-control": file.includes(path.sep + "assets" + path.sep) ? "public, max-age=31536000, immutable" : "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message || "Could not build the itinerary. Please try again." });
  }
}).listen(PORT, () => console.log(`RoamPlan running at http://localhost:${PORT}`));
