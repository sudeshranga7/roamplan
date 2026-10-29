// Rule-based itinerary planner. No AI: real places come from OpenStreetMap (Nominatim + Overpass),
// the destination blurb from Wikivoyage, and "popular now" from Wikipedia pageviews.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const UA = "RoamPlan/1.0 (+https://roamplan.onrender.com)";
const CACHE_DIR = path.join(__dirname, ".cache");
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];

// ---------- caching ----------
// .cache/ is the runtime cache (wiped on every Render restart). .seed/ is committed to git and holds
// pre-fetched popular destinations (see scripts/seed.js), trusted for SEED_TTL instead of a week.
const SEED_DIR = path.join(__dirname, ".seed");
const SEED_TTL = 180 * 864e5;
const SEEDING = process.env.ROAMPLAN_SEED === "1";
const seedable = (key) => /^(geo|poi3|blurb2):/.test(key);
const hashName = (key) => crypto.createHash("sha1").update(key).digest("hex") + ".json";

function readSeed(key) {
  if (!seedable(key)) return undefined;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(SEED_DIR, hashName(key)), "utf8"));
    if (Date.now() - s.t < SEED_TTL) return s.v;
  } catch {}
  return undefined;
}

// `keep` decides whether a fresh result is worth saving (partial results aren't).
async function cached(key, ttlMs, fn, keep = () => true) {
  const file = path.join(CACHE_DIR, hashName(key));
  const seed = readSeed(key);
  if (seed !== undefined) return seed;
  let stale = null;
  if (!(SEEDING && seedable(key))) try { // when seeding, fetch fresh instead of copying the runtime cache
    const st = fs.statSync(file);
    stale = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Date.now() - st.mtimeMs < ttlMs) return stale;
  } catch {}
  let val;
  try { val = await fn(); } catch (e) { if (stale) return stale; throw e; } // old data beats an error
  if (keep(val)) {
    if (SEEDING && seedable(key)) {
      fs.mkdirSync(SEED_DIR, { recursive: true });
      fs.writeFileSync(path.join(SEED_DIR, hashName(key)), JSON.stringify({ t: Date.now(), v: val }));
    } else {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(val));
    }
  }
  return val;
}
const DAY = 864e5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Nominatim's usage policy allows one request per second, so every call goes through one queue.
let nomQueue = Promise.resolve();
function nominatim(params) {
  const run = nomQueue.then(async () => {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&${new URLSearchParams(params)}`, {
      headers: { "user-agent": UA, referer: "https://roamplan.onrender.com" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Nominatim ${r.status}`);
    return r.json();
  });
  nomQueue = run.catch(() => {}).then(() => sleep(1100));
  return run;
}

// ---------- interests -> categories ----------
const INTEREST_WORDS = [
  ["beach", /beach|sea|sand|coast/],
  ["cafe", /caf[eé]|coffee|brunch|bakery/],
  ["nightlife", /club|nightlife|party|parties|pub|bar|drinks|dj/],
  ["watersports", /water|surf|dive|diving|scuba|jet|parasail|kayak|snorkel|sail/],
  ["restaurant", /food|restaurant|eat|cuisine|seafood|dining/],
  ["sight", /sight|heritage|history|museum|fort|church|temple|culture|monument|landmark|gallery/],
  ["nature", /nature|park|hike|trek|waterfall|garden|wildlife|outdoor/],
  ["shopping", /shop|market|mall|souvenir/],
];
// Preferences can come from the form's checkboxes or from words in the interests box.
function parsePrefs(list, text) {
  const t = String(text || "").toLowerCase(), l = Array.isArray(list) ? list : [];
  return {
    veg: l.includes("veg") || /vegetarian|vegan|\bveg\b/.test(t),
    wheelchair: l.includes("wheelchair") || /wheelchair|accessib/.test(t),
  };
}

function parseInterests(text) {
  const t = String(text || "").toLowerCase();
  const found = INTEREST_WORDS.filter(([, re]) => re.test(t)).map(([c]) => c);
  return found.length ? found : ["sight", "nature", "cafe"];
}

// ---------- OpenStreetMap queries ----------
const CATS = {
  beach: { nom: ["beach"], q: ['nwr["natural"="beach"]["name"]'], limit: 80 },
  cafe: { nom: ["cafe"], q: ['nwr["amenity"="cafe"]["name"]'], limit: 120 },
  restaurant: { nom: ["restaurant"], q: ['nwr["amenity"="restaurant"]["name"]'], limit: 150 },
  nightlife: { nom: ["nightclub", "bar", "pub"], q: ['nwr["amenity"~"^(nightclub|bar|pub)$"]["name"]'], limit: 120 },
  watersports: {
    nom: ["water sports", { q: "scuba" }, { q: "surf" }, { q: "kayak" }],
    q: [
      'nwr["sport"~"surfing|scuba_diving|water_ski|kayak|canoe|sailing|kitesurfing|windsurfing"]["name"]',
      'nwr["shop"="scuba_diving"]["name"]',
      'nwr[~"^(leisure|tourism|shop)$"~"."]["name"~"parasail|jet ?ski|water ?sport|banana boat|scuba|snorkel|kayak|diving",i]',
    ],
    limit: 60,
  },
  sight: {
    nom: ["attraction", "museum", "viewpoint", "castle", "monument", "place of worship"],
    q: [
      'nwr["tourism"~"^(attraction|viewpoint|museum|gallery|zoo|theme_park|aquarium)$"]["name"]',
      'nwr["historic"~"^(castle|fort|monument|ruins|archaeological_site|memorial)$"]["name"]',
      'nwr["amenity"="place_of_worship"]["wikipedia"]["name"]',
    ],
    limit: 120,
  },
  nature: { nom: ["park", "garden", "nature reserve", "waterfall"], q: ['nwr["leisure"~"^(park|nature_reserve|garden)$"]["name"]', 'nwr["natural"~"^(waterfall|peak|cave_entrance)$"]["name"]'], limit: 80 },
  shopping: { nom: ["mall", "marketplace"], q: ['nwr["shop"~"^(mall|department_store)$"]["name"]', 'nwr["amenity"="marketplace"]["name"]'], limit: 60 },
};

async function geocode(place) {
  return cached("geo:" + place.toLowerCase(), 30 * DAY, async () => {
    const g = (await nominatim({ q: place, limit: 1, "accept-language": "en" }))[0];
    if (!g) return null;
    let [s, n, w, e] = g.boundingbox.map(Number);
    const lat = +g.lat, lon = +g.lon;
    const fit = (lo, hi, c, min, max) => (hi - lo > max ? [c - max / 2, c + max / 2] : hi - lo < min ? [c - min / 2, c + min / 2] : [lo, hi]);
    [s, n] = fit(s, n, lat, 0.08, 1.2);
    [w, e] = fit(w, e, lon, 0.08, 1.2);
    return { name: g.name || place, lat, lon, bbox: [s, w, n, e] };
  });
}

// Public Overpass servers are often overloaded: ask every mirror at once and take the first answer.
// Only used to top up thin Nominatim results.
async function overpass(query) {
  const one = async (url) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
      body: "data=" + encodeURIComponent(query),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`Overpass ${r.status}`);
    return (await r.json()).elements;
  };
  try { return await Promise.any(OVERPASS.map(one)); }
  catch { throw new Error("Overpass unavailable"); }
}

function classify(t) {
  const amenity = t.amenity || "";
  if (t.natural === "beach") return "beach";
  if (amenity === "cafe") return "cafe";
  if (amenity === "restaurant") return "restaurant";
  if (/^(nightclub|bar|pub)$/.test(amenity)) return "nightlife";
  if (/surfing|scuba|water_ski|kayak|canoe|sailing|kitesurf|windsurf/.test(t.sport || "") || /^(scuba_diving|water_sports)$/.test(t.shop || "") ||
      (!amenity && /parasail|jet ?ski|water ?sport|banana boat|scuba|snorkel|kayak|diving/i.test(t.name || ""))) return "watersports";
  if (/^(attraction|viewpoint|museum|gallery|zoo|theme_park|aquarium)$/.test(t.tourism || "") || t.historic || (amenity === "place_of_worship" && t.wikipedia)) return "sight";
  if (/^(park|nature_reserve|garden)$/.test(t.leisure || "") || /^(waterfall|peak|cave_entrance)$/.test(t.natural || "") || t.waterway === "waterfall") return "nature";
  if (/^(mall|department_store)$/.test(t.shop || "") || amenity === "marketplace") return "shopping";
  return null;
}

// More complete OSM entries tend to be the better-known places.
function score(t, cat) {
  let s = 0;
  if (t.wikipedia) s += 3;
  if (t.wikidata) s += 2;
  if (t.website || t["contact:website"]) s += 1;
  if (t.opening_hours) s += 1;
  if (t.phone || t["contact:phone"]) s += 1;
  if (t.cuisine) s += 1;
  if (t.description) s += 1;
  if (t.stars) s += 1;
  if (cat === "nightlife" && t.amenity === "nightclub") s += 1;
  return s;
}

function makePoi(id, t, lat, lon, bonus = 0) {
  const name = t["name:en"] && t.name && t["name:en"] !== t.name && !t.name.includes(t["name:en"]) ? `${t["name:en"]} (${t.name})` : t["name:en"] || t.name;
  const cat = classify(t);
  if (!cat || !name || lat == null || lon == null) return null;
  return {
    id, name, cat, lat: +lat, lon: +lon, score: score(t, cat) + bonus,
    viewpoint: t.tourism === "viewpoint", club: t.amenity === "nightclub",
    cuisine: t.cuisine, hours: t.opening_hours, website: t.website || t["contact:website"], wikipedia: t.wikipedia,
    veg: /^(yes|only)$/.test(t["diet:vegetarian"] || "") || /^(yes|only)$/.test(t["diet:vegan"] || "") || undefined,
    wheelchair: t.wheelchair || undefined,
  };
}

// Nominatim result -> OSM-style tags, so classify/score work the same for both sources.
// Names show as "English (local)" when both exist, e.g. "Tokyo Tower (東京タワー)".
function displayName(x) {
  const local = x.namedetails?.name || x.name, en = x.namedetails?.["name:en"];
  return en && local && en !== local ? `${en} (${local})` : en || local;
}
const fromNominatim = (x) =>
  makePoi(x.osm_type + x.osm_id, { ...(x.extratags || {}), name: displayName(x), [x.category]: x.type }, x.lat, x.lon, Math.round((x.importance || 0) * 5));
const fromOverpass = (el) => makePoi(el.type + el.id, el.tags || {}, el.lat ?? el.center?.lat, el.lon ?? el.center?.lon);

// One cache entry per category, so a failure in one can't sink the rest.
async function fetchCat(geo, cat) {
  // Nominatim searches the whole area (it ranks by importance, so size costs nothing);
  // Overpass gets a smaller box to keep its queries light.
  const [s, w, n, e] = geo.bbox;
  const clamp = (lo, hi, max) => (hi - lo > max ? [(lo + hi) / 2 - max / 2, (lo + hi) / 2 + max / 2] : [lo, hi]);
  const [os, on] = clamp(s, n, 0.5), [ow, oe] = clamp(w, e, 0.5);
  const key = `poi3:${geo.lat.toFixed(3)},${geo.lon.toFixed(3)}:${cat}`;
  const val = await cached(key, 7 * DAY, async () => {
    const pois = [], seen = new Set();
    const add = (p) => { if (p && !seen.has(p.id)) { seen.add(p.id); pois.push(p); } };
    let ok = 0, failed = 0;
    for (const phrase of CATS[cat].nom) {
      const params = { ...(typeof phrase === "string" ? { amenity: phrase } : phrase),
        limit: 40, viewbox: `${w},${n},${e},${s}`, bounded: 1, extratags: 1, namedetails: 1 };
      try { (await nominatim(params)).forEach((x) => add(fromNominatim(x))); ok++; }
      catch (err) { failed++; console.error(`nominatim ${cat}/${params.amenity || params.q}: ${err.message}`); }
    }
    if (pois.length < 10) {
      try {
        const bb = `(${os},${ow},${on},${oe})`;
        (await overpass(`[out:json][timeout:18];(${CATS[cat].q.map((q) => q + bb + ";").join("")});out center tags ${CATS[cat].limit};`)).forEach((el) => add(fromOverpass(el)));
        ok++;
      } catch {}
    }
    if (!ok) throw new Error("all sources failed");
    return { pois, complete: failed === 0 };
  }, (v) => v.complete);
  return Array.isArray(val) ? val : val.pois; // older cache files hold a bare array
}

async function fetchPois(geo, cats, onCat = () => {}) {
  const list = [...cats], results = [], failed = [];
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < list.length) {
      const cat = list[next++];
      onCat(cat);
      try { results.push(...(await fetchCat(geo, cat))); } catch (e) { failed.push(cat); console.error(`${cat} failed for ${geo.name}: ${e.message}`); }
    }
  }));
  const seen = new Set();
  return { pois: results.filter((p) => !seen.has(p.id) && seen.add(p.id)), failed };
}

// ---------- extras: destination blurb + popularity ----------
async function blurb(name) {
  return cached("blurb2:" + name.toLowerCase(), 7 * DAY, async () => {
    for (const host of ["en.wikivoyage.org", "en.wikipedia.org"]) {
      try {
        const r = await fetch(`https://${host}/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(name)}`, { headers: { "user-agent": UA } });
        const page = Object.values((await r.json()).query.pages)[0];
        const text = (page.extract || "").replace(/\s*\([^)]*[^\x00-\x7F][^)]*\)/g, "").replace(/\s+/g, " ").trim();
        if (text.length > 60) {
          let out = "";
          for (const sent of text.split(/(?<=[.!?])\s+/).filter((x) => !/^(For\b.*\bsee\b|This article\b)/i.test(x))) { if ((out + sent).length > 320 && out) break; out += (out ? " " : "") + sent; }
          return out;
        }
      } catch {}
    }
    return "";
  });
}

async function pageviews(wikipedia) {
  const m = /^([a-z-]+):(.+)$/.exec(wikipedia || "");
  if (!m) return 0;
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const end = new Date(Date.now() - DAY), start = new Date(end - 30 * DAY);
  return cached(`pv:${wikipedia}:${fmt(end)}`, 6 * 3600e3, async () => {
    try {
      const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${m[1]}.wikipedia/all-access/user/${encodeURIComponent(m[2].replace(/ /g, "_"))}/daily/${fmt(start)}/${fmt(end)}`;
      const r = await fetch(url, { headers: { "user-agent": UA } });
      if (!r.ok) return 0;
      return (await r.json()).items.reduce((a, i) => a + i.views, 0);
    } catch { return 0; }
  });
}

const CAT_LABEL = { beach: "Beach", cafe: "Café", restaurant: "Food", nightlife: "Nightlife", watersports: "Watersports", sight: "Sight", nature: "Nature", shopping: "Shopping" };

async function buildTrends(allPois) {
  const withWiki = allPois.filter((p) => p.wikipedia).sort((a, b) => b.score - a.score).slice(0, 10);
  const views = await Promise.all(withWiki.map((p) => pageviews(p.wikipedia)));
  const ranked = withWiki.map((p, i) => ({ p, v: views[i] })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 5);
  const trends = ranked.map(({ p, v }) => ({ title: p.name, note: `${CAT_LABEL[p.cat]} · ${v.toLocaleString("en-US")} Wikipedia views in the last 30 days.` }));
  if (trends.length < 3) {
    const have = new Set(trends.map((t) => t.title));
    for (const p of [...allPois].sort((a, b) => b.score - a.score)) {
      if (trends.length >= 4) break;
      if (!have.has(p.name) && p.score >= 3) { have.add(p.name); trends.push({ title: p.name, note: `${CAT_LABEL[p.cat]} · among the best-documented places on OpenStreetMap here.` }); }
    }
  }
  return trends;
}

// ---------- opening hours ----------
// Understands the common OSM forms: "24/7", "Mo-Fr 09:00-18:00; Sa 10:00-14:00", "Tu-Su 18:00-02:00",
// "Mo off", comma lists of days or times. Returns true/false for weekday (0 = Monday) and minute of day,
// or null when the text is missing or too unusual to read (we then assume it's open).
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const hoursCache = new Map();

function parseHours(spec) {
  if (hoursCache.has(spec)) return hoursCache.get(spec);
  let week = null;
  try {
    const s = String(spec || "").trim();
    if (!s) throw 0;
    if (s === "24/7") week = Array.from({ length: 7 }, () => [[0, 1440]]);
    else {
      week = Array.from({ length: 7 }, () => null);
      let sawDays = false;
      for (const rule of s.split(";").map((r) => r.trim()).filter(Boolean)) {
        const m = /^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*[-,]\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))*)?\s*(.*)$/.exec(rule);
        const days = new Set();
        if (m[1]) {
          sawDays = true;
          for (const part of m[1].split(",")) {
            const [from, to] = part.split("-").map((d) => DAYS.indexOf(d.trim()));
            if (to === undefined) days.add(from);
            else for (let d = from; ; d = (d + 1) % 7) { days.add(d); if (d === to) break; }
          }
        } else DAYS.forEach((_, i) => days.add(i));
        const rest = m[2].trim();
        let ranges;
        if (/^(off|closed)$/i.test(rest)) ranges = [];
        else if (rest === "24/7" || rest === "00:00-24:00") ranges = [[0, 1440]];
        else {
          ranges = rest.split(",").map((r) => {
            const t = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/.exec(r.trim());
            if (!t) throw 0;
            const open = +t[1] * 60 + +t[2];
            let close = +t[3] * 60 + +t[4];
            if (close <= open) close += 1440; // past midnight
            return [open, close];
          });
        }
        for (const d of days) week[d] = ranges;
      }
      // Days never mentioned are closed when the rules name days; otherwise rules applied to all.
      if (sawDays) week = week.map((r) => r || []);
    }
  } catch { week = null; }
  hoursCache.set(spec, week);
  return week;
}

function openAt(spec, wd, min) {
  const week = parseHours(spec);
  if (!week) return null;
  const inRange = (ranges, m) => (ranges || []).some(([o, c]) => m >= o && m < c);
  return inRange(week[wd], min) || inRange(week[(wd + 6) % 7], min + 1440);
}

// ---------- scheduling ----------
const km = (a, b) => {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// kind: breakfast | act | lunch | cafe | sunset | dinner | night
const PACES = {
  relaxed: { tagline: "Slow mornings, a couple of highlights a day, early nights.", slots: [["11:00", "act"], ["13:30", "lunch"], ["16:00", "cafe"], ["17:45", "sunset"], ["20:00", "dinner"], ["22:00", "night"]],
    tips: ["Sunday-style buffer: keep the last day light.", "Nightlife appears on one night only; swap it if you'd rather rest."] },
  mid: { tagline: "A balanced day: three activities with proper meal breaks.", slots: [["09:30", "breakfast"], ["11:00", "act"], ["13:30", "lunch"], ["15:30", "act"], ["17:45", "sunset"], ["20:00", "dinner"], ["22:00", "night"]],
    tips: ["Start outdoor activities before noon to beat heat and crowds."] },
  hectic: { tagline: "Everything in, from first light to last call.", slots: [["08:00", "breakfast"], ["09:30", "act"], ["11:30", "act"], ["13:30", "lunch"], ["15:00", "act"], ["16:30", "act"], ["17:45", "sunset"], ["20:00", "dinner"], ["22:00", "night"]],
    tips: ["This is a lot. For groups, consider splitting up for some activities."] },
};
const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3);

const BASE = {
  beach: "Swim, walk and take group photos.", watersports: "Ask about group rates and safety gear before booking.",
  sight: "Check opening hours before you go.", nature: "Carry water and wear comfortable shoes.", shopping: "Good for souvenirs and a break from the sun.",
  cafe: "Coffee and a break.", restaurant: "Local food.", nightlife: "Evening out.",
};
const OUTDOOR = new Set(["beach", "nature", "watersports"]);
const isOutdoor = (p) => OUTDOOR.has(p.cat) || p.viewpoint;

// `now` is shared with buildPlan and describes the slot being filled: weekday, minute, rain, preferences.
function makePicker(pools, now) {
  const used = new Set(), names = new Set();
  const fit = (p) => p.score
    + (now.prefs.veg && (p.cat === "restaurant" || p.cat === "cafe") && p.veg ? 4 : 0)
    + (now.prefs.wheelchair ? (p.wheelchair === "yes" ? 3 : p.wheelchair === "no" ? -4 : 0) : 0)
    - (now.rainy && isOutdoor(p) ? 5 : 0);
  const pick = (cats, near) => {
    pick.alts = [];
    const cand = [];
    for (const c of cats) {
      let n = 0;
      for (const p of pools[c] || []) {
        if (used.has(p.id) || names.has(p.name)) continue;
        if (now.wd != null && openAt(p.hours, now.wd, now.min) === false) continue; // closed then
        cand.push(p);
        if (++n >= 15) break;
      }
    }
    if (!cand.length) return null;
    const cost = (p) => (near ? km(near, p) : 0) - 0.6 * fit(p);
    cand.sort((a, b) => cost(a) - cost(b));
    const best = cand[0];
    used.add(best.id); names.add(best.name);
    pick.alts = cand.slice(1).filter((p) => p.name !== best.name).slice(0, 2); // runner-ups to swap in
    return best;
  };
  return pick;
}

function slotFor(p, time, ctx, kind) {
  const parts = [BASE[p.cat]];
  if (kind === "sunset") parts[0] = p.cat === "beach" ? "Sunset on the beach: swim, walk and take group photos." : p.viewpoint ? "Catch the sunset from here." : parts[0];
  if ((kind === "lunch" || kind === "dinner") && p.cat === "cafe") parts[0] = kind === "lunch" ? "Light lunch." : "Casual dinner.";
  if (p.cuisine) {
    const c = p.cuisine.split(";").slice(0, 3).join(", ").replace(/_/g, " ");
    parts[0] = `${c[0].toUpperCase()}${c.slice(1)} cuisine.`;
  }
  if (p.veg && /cafe|restaurant/.test(p.cat)) parts.push("Vegetarian options.");
  if (p.wheelchair === "yes") parts.push("Wheelchair accessible.");
  else if (p.wheelchair === "limited") parts.push("Limited wheelchair access.");
  if (p.hours && p.cat !== "beach") parts.push(`Hours: ${p.hours.slice(0, 60)}.`);
  if (ctx.travellers >= 8 && /cafe|restaurant|nightlife/.test(p.cat)) parts.push(`Reserve ahead for ${ctx.travellers} people.`);
  return {
    time, title: p.name, desc: parts.join(" "), tag: p.cat === "nightlife" ? (p.club ? "Club" : "Bar") : CAT_LABEL[p.cat],
    lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6),
    link: `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=17/${p.lat}/${p.lon}`, website: p.website || undefined,
  };
}

const isRainy = (w) => !!w && ((w.prob ?? 0) >= 60 || (w.mm ?? 0) >= 5);

function buildPlan(paceKey, segments, ctx) {
  const pace = PACES[paceKey], days = [], total = ctx.days;
  let dayIdx = 0;
  for (const seg of segments) {
    const now = { wd: null, min: 0, rainy: false, prefs: ctx.prefs };
    const pick = makePicker(seg.pools, now);
    let actI = 0;
    for (let k = 0; k < seg.days; k++, dayIdx++) {
      const date = new Date(new Date(ctx.start + "T12:00:00Z").getTime() + dayIdx * DAY).toISOString().slice(0, 10);
      const wx = seg.rain?.[date];
      now.wd = (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7;
      now.rainy = isRainy(wx);
      const first = dayIdx === 0, last = dayIdx === total - 1, arriving = k === 0;
      const nightOK = ctx.interests.includes("nightlife") && (paceKey === "relaxed" ? dayIdx === Math.min(1, total - 1) : !last || total === 1);
      let defs = pace.slots.filter(([, kind]) => (kind === "night" ? nightOK : kind === "cafe" ? ctx.interests.includes("cafe") : true));
      if (total > 1 && (first || arriving)) defs = defs.filter(([t]) => toMin(t) >= (first ? 780 : 720));
      if (total > 1 && last) defs = defs.filter(([t]) => toMin(t) <= 930);
      const slots = [];
      if (first && total > 1) slots.push({ time: "Arrival", title: `Arrive in ${seg.name}`, desc: "Check in, drop bags and freshen up.", tag: "Stay" });
      else if (arriving && !first) slots.push({ time: "Morning", title: `Travel to ${seg.name}`, desc: "Allow half a day for the transfer and check-in.", tag: "Travel" });
      let prev = null; const kinds = [];
      const activity = (near) => {
        const acts = ctx.interests.filter((c) => !/^(cafe|restaurant|nightlife)$/.test(c));
        let order = acts.length ? acts : ["sight", "nature"];
        if (now.rainy) { const dry = order.filter((c) => !OUTDOOR.has(c)); order = dry.length ? dry : ["sight"]; }
        let p = null;
        for (let t = 0; t < order.length && !p; t++) p = pick([order[(actI + t) % order.length]], near);
        actI++;
        return p || pick(now.rainy ? ["sight", "shopping", "cafe"] : ["sight", "nature", "beach"], near);
      };
      for (const [time, kind] of defs) {
        now.min = toMin(time) + 30; // be open around the middle of the visit
        let p = null;
        if (kind === "breakfast" || kind === "cafe") p = pick(["cafe"], prev) || (kind === "breakfast" ? pick(["restaurant"], prev) : null);
        else if (kind === "lunch" || kind === "dinner") p = pick(["restaurant", "cafe"], prev);
        else if (kind === "night") p = pick(["nightlife"], prev);
        else if (kind === "sunset" && !now.rainy) {
          // Beaches only for beach lovers; otherwise a viewpoint, a park, or simply another activity.
          const spots = [...(ctx.interests.includes("beach") ? ["beach"] : []), "viewpoint", ...(ctx.interests.includes("nature") ? ["nature"] : [])];
          for (const c of spots) if (!p) p = pick([c], prev);
          if (!p) p = activity(prev);
        } else p = activity(prev);
        if (!p) continue;
        const slot = slotFor(p, time, ctx, kind);
        const alts = pick.alts.map((a) => slotFor(a, time, ctx, kind));
        if (alts.length) slot.alts = alts;
        slots.push(slot);
        prev = p;
        if (kind === "act" || kind === "sunset") kinds.push(p.cat);
      }
      if (last && total > 1) slots.push({ time: "Afternoon", title: "Head home", desc: "Leave a 3-hour buffer for your airport or station.", tag: "Travel" });
      const themes = [...new Set(kinds)].slice(0, 2).map((c) => ({ beach: "Beaches", watersports: "Watersports", sight: "Sights", nature: "Nature", shopping: "Shopping" }[c])).filter(Boolean);
      const day = { day: dayIdx + 1, date, title: `${seg.name}${themes.length ? " · " + themes.join(" & ") : ""}`, slots };
      if (wx) day.weather = wx;
      if (now.rainy) day.note = "Rain is likely, so indoor places come first today.";
      days.push(day);
    }
  }
  return { tagline: pace.tagline, days, tips: pace.tips };
}

function groupTips(n, interests, prefs) {
  const tips = [];
  if (n >= 10) tips.push(`With ${n} people, reserve restaurants and nightlife a few days ahead; many venues can't seat a group this size on the day.`);
  if (n >= 10) tips.push("Split into two tables or sub-groups if a venue can't take everyone together.");
  if (n >= 9) tips.push("Hire one minibus or tempo traveller for the whole trip instead of many cabs.");
  else if (n >= 5) tips.push(`Plan on about ${Math.ceil(n / 4)} cabs, or hire a larger vehicle for the trip.`);
  if (interests.includes("nightlife") && n >= 6) tips.push("Ask clubs about group entry and cover-charge policies before you go.");
  if (interests.includes("watersports") && n >= 6) tips.push("Book watersports as a group package and negotiate a per-head rate.");
  if (prefs.veg) tips.push("Places marked vegetarian-friendly on OpenStreetMap are ranked first, but many good options aren't tagged; ask locally too.");
  if (prefs.wheelchair) tips.push("Wheelchair-accessible places are preferred where OpenStreetMap records it; call ahead to confirm step-free access.");
  tips.push("Opening hours come from OpenStreetMap and stops are scheduled around them where known; confirm before you go.");
  return tips;
}

// ---------- weather (Open-Meteo) ----------
// Rain chance per date, only when the trip is inside the 16-day forecast window.
async function rainByDate(geo, start, days) {
  const s = new Date(start + "T12:00:00Z");
  const ahead = (s - Date.now()) / DAY;
  if (ahead < -1 || ahead + days > 15) return {};
  const end = new Date(s.getTime() + (days - 1) * DAY).toISOString().slice(0, 10);
  try {
    return await cached(`wx:${geo.lat.toFixed(2)},${geo.lon.toFixed(2)}:${start}:${end}`, 3 * 3600e3, async () => {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&daily=precipitation_probability_max,precipitation_sum&timezone=auto&start_date=${start}&end_date=${end}`,
        { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
      const d = (await r.json()).daily, out = {};
      d.time.forEach((t, i) => { out[t] = { prob: d.precipitation_probability_max?.[i] ?? null, mm: d.precipitation_sum?.[i] ?? null }; });
      return out;
    });
  } catch { return {}; } // weather is a nice-to-have
}

// ---------- entry point ----------
// Problems with the request itself (unknown place, no data) rather than bugs.
class UserError extends Error { constructor(msg) { super(msg); this.status = 422; } }

const CAT_PLURAL = { beach: "beaches", cafe: "cafés", restaurant: "restaurants", nightlife: "bars and clubs", watersports: "watersports", sight: "sights", nature: "parks and nature", shopping: "markets and malls" };

async function plan(input, progress = () => {}) {
  const interests = parseInterests(input.interests);
  const prefs = parsePrefs(input.prefs, input.interests);
  const cats = new Set([...interests, "restaurant", "sight", "cafe"]);
  const names = input.places;
  const nDays = Math.min(input.days, 14);
  const used = names.slice(0, nDays);

  const segments = [];
  const allPois = [];
  const missing = [];
  for (const name of used) {
    progress(`Finding ${name} on the map`);
    const geo = await geocode(name);
    if (!geo) throw new UserError(`Couldn't find "${name}". Try a more specific name.`);
    const { pois, failed } = await fetchPois(geo, cats, (cat) => progress(`Looking for ${CAT_PLURAL[cat]} in ${name}`));
    if (failed.length) missing.push(`${failed.join(", ")} for ${name}`);
    const pools = {};
    for (const p of pois) (pools[p.cat] ||= []).push(p);
    for (const c in pools) pools[c].sort((a, b) => b.score - a.score);
    pools.viewpoint = (pools.sight || []).filter((p) => p.viewpoint);
    if (pois.length < 5) throw new UserError(failed.length
      ? `The free map servers are busy, so we couldn't load places for "${name}". Please try again in a minute.`
      : `Not enough mapped places found for "${name}". Try a nearby city or a more specific name.`);
    segments.push({ name, pools, geo });
    allPois.push(...pois);
  }
  const base = Math.floor(nDays / used.length);
  segments.forEach((s, i) => (s.days = base + (i < nDays % used.length ? 1 : 0)));

  progress("Checking the weather");
  await Promise.all(segments.map(async (s) => { s.rain = await rainByDate(s.geo, input.startDate, nDays); }));

  progress("Building your itineraries");
  const ctx = { days: nDays, start: input.startDate, travellers: input.travellers, interests, prefs };
  const plans = {};
  for (const k of Object.keys(PACES)) plans[k] = buildPlan(k, segments, ctx);

  progress("Finding what's popular");
  const [intro, trends] = await Promise.all([blurb(used[0]), buildTrends(allPois)]);
  const skipped = names.slice(nDays);
  return {
    destination: used.join(" → "),
    places: used,
    summary: [intro, skipped.length ? `Not enough days to include: ${skipped.join(", ")}.` : "",
      missing.length ? `Note: the free map servers were busy, so some places are missing (${missing.join("; ")}). Search again in a minute to fill them in.` : ""].filter(Boolean).join(" ") ||
      `A ${nDays}-day plan for ${used.join(", ")}.`,
    trends, groupTips: groupTips(input.travellers, interests, prefs), plans,
  };
}

module.exports = { plan, geocode, fetchPois, blurb, CATS, openAt, buildPlan, makePicker, parseInterests, parsePrefs, PACES };
