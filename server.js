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
  ".webmanifest": "application/manifest+json",
};

// Per-IP limit on plan requests, to protect the free Nominatim and Render quotas.
// On Render the client's address is the first entry of x-forwarded-for.
const WINDOW_MS = 10 * 60e3, MAX_PLANS = 30;
const hits = new Map();
function rateLimited(req) {
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress;
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  const limited = recent.length >= MAX_PLANS;
  if (!limited) recent.push(now);
  hits.set(ip, recent);
  return limited;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of hits) if (!list.some((t) => now - t < WINDOW_MS)) hits.delete(ip);
}, WINDOW_MS).unref();

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
    if (req.url === "/healthz") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("ok"); }
    if (req.method === "POST" && req.url === "/api/itinerary") {
      let input;
      try { input = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: "Invalid request." }); }
      if (!input || !Array.isArray(input.places) || !input.places.length || !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate || ""))
        return send(res, 400, { error: "Please provide places and a start date." });
      input.places = input.places.slice(0, 6).map((p) => String(p).trim().slice(0, 80)).filter(Boolean);
      input.days = Math.min(Math.max(parseInt(input.days) || 3, 1), 14);
      input.travellers = Math.min(Math.max(parseInt(input.travellers) || 1, 1), 200);
      input.interests = String(input.interests || "").slice(0, 300);
      input.prefs = Array.isArray(input.prefs) ? input.prefs.filter((p) => p === "veg" || p === "wheelchair") : [];
      if (rateLimited(req)) return send(res, 429, { error: "That's a lot of plans in a short time. Please wait a few minutes and try again." });

      // Browsers ask for NDJSON: progress lines while we work, then the result. Plain JSON otherwise.
      if (!String(req.headers.accept || "").includes("application/x-ndjson")) return send(res, 200, await plan(input));
      res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache", "x-accel-buffering": "no" });
      const line = (obj) => res.write(JSON.stringify(obj) + "\n");
      try {
        line({ result: await plan(input, (msg) => line({ progress: msg })) });
      } catch (e) {
        if (!e.status) console.error(e);
        line({ error: e.status ? e.message : "Something went wrong building the itinerary. Please try again." });
      }
      return res.end();
    }
    // Static files from dist/, with index.html as the fallback for the single-page app.
    let rel;
    try { rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, ""); } catch { res.writeHead(400); return res.end("Bad request"); }
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
    if (e.status) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: "Something went wrong building the itinerary. Please try again." });
  }
}).listen(PORT, () => console.log(`RoamPlan running at http://localhost:${PORT}`));

// Render's free tier sleeps after ~15 idle minutes. A request to our own public URL counts as traffic,
// so pinging every 10 minutes keeps it awake. Render sets RENDER_EXTERNAL_URL; set KEEP_AWAKE=0 to turn off.
if (process.env.RENDER_EXTERNAL_URL && process.env.KEEP_AWAKE !== "0") {
  const url = process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "") + "/healthz";
  setInterval(() => fetch(url).catch(() => {}), 10 * 60e3).unref();
  console.log(`Keep-awake ping enabled: ${url}`);
}
