// Rule-based itinerary planner. No AI: real places come from OpenStreetMap (Nominatim + Overpass),
// the destination blurb from Wikivoyage, and "popular now" from Wikipedia pageviews.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const UA = "RoamPlan/1.0 (self-hosted trip planner)";
const CACHE_DIR = path.join(__dirname, ".cache");
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

// ---------- caching ----------
async function cached(key, ttlMs, fn) {
  const file = path.join(CACHE_DIR, crypto.createHash("sha1").update(key).digest("hex") + ".json");
  let stale = null;
  try {
    const st = fs.statSync(file);
    stale = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Date.now() - st.mtimeMs < ttlMs) return stale;
  } catch {}
  let val;
  try { val = await fn(); } catch (e) { if (stale) return stale; throw e; } // old data beats an error
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(val));
  return val;
}
const DAY = 864e5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastNominatim = 0;

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
function parseInterests(text) {
  const t = String(text || "").toLowerCase();
  const found = INTEREST_WORDS.filter(([, re]) => re.test(t)).map(([c]) => c);
  return found.length ? found : ["sight", "nature", "cafe"];
}

// ---------- OpenStreetMap queries ----------
const CATS = {
  beach: { q: ['nwr["natural"="beach"]["name"]'], limit: 80 },
  cafe: { q: ['nwr["amenity"="cafe"]["name"]'], limit: 120 },
  restaurant: { q: ['nwr["amenity"="restaurant"]["name"]'], limit: 150 },
  nightlife: { q: ['nwr["amenity"~"^(nightclub|bar|pub)$"]["name"]'], limit: 120 },
  watersports: {
    q: [
      'nwr["sport"~"surfing|scuba_diving|water_ski|kayak|canoe|sailing|kitesurfing|windsurfing"]["name"]',
      'nwr["shop"="scuba_diving"]["name"]',
      'nwr[~"^(leisure|tourism|shop)$"~"."]["name"~"parasail|jet ?ski|water ?sport|banana boat|scuba|snorkel|kayak|diving",i]',
    ],
    limit: 60,
  },
  sight: {
    q: [
      'nwr["tourism"~"^(attraction|viewpoint|museum|gallery|zoo|theme_park|aquarium)$"]["name"]',
      'nwr["historic"~"^(castle|fort|monument|ruins|archaeological_site|memorial)$"]["name"]',
      'nwr["amenity"="place_of_worship"]["wikipedia"]["name"]',
    ],
    limit: 120,
  },
  nature: { q: ['nwr["leisure"~"^(park|nature_reserve|garden)$"]["name"]', 'nwr["natural"~"^(waterfall|peak|cave_entrance)$"]["name"]'], limit: 80 },
  shopping: { q: ['nwr["shop"~"^(mall|department_store)$"]["name"]', 'nwr["amenity"="marketplace"]["name"]'], limit: 60 },
};

async function geocode(place) {
  return cached("geo:" + place.toLowerCase(), 30 * DAY, async () => {
    const wait = 1100 - (Date.now() - lastNominatim);
    if (wait > 0) await sleep(wait);
    lastNominatim = Date.now();
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(place)}`, { headers: { "user-agent": UA } });
    if (!r.ok) throw new Error(`Geocoding failed (${r.status})`);
    const g = (await r.json())[0];
    if (!g) return null;
    let [s, n, w, e] = g.boundingbox.map(Number);
    const lat = +g.lat, lon = +g.lon;
    const fit = (lo, hi, c, min, max) => (hi - lo > max ? [c - max / 2, c + max / 2] : hi - lo < min ? [c - min / 2, c + min / 2] : [lo, hi]);
    [s, n] = fit(s, n, lat, 0.08, 1.2);
    [w, e] = fit(w, e, lon, 0.08, 1.2);
    return { name: g.name || place, lat, lon, bbox: [s, w, n, e] };
  });
}

async function overpass(query) {
  let err;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(50000),
      });
      if (r.ok) return (await r.json()).elements;
      err = new Error(`Overpass ${r.status}`);
    } catch (e) { err = e; }
  }
  throw err;
}

function classify(t) {
  const amenity = t.amenity || "";
  if (t.natural === "beach") return "beach";
  if (amenity === "cafe") return "cafe";
  if (amenity === "restaurant") return "restaurant";
  if (/^(nightclub|bar|pub)$/.test(amenity)) return "nightlife";
  if (/surfing|scuba|water_ski|kayak|canoe|sailing|kitesurf|windsurf/.test(t.sport || "") || t.shop === "scuba_diving" ||
      (!amenity && /parasail|jet ?ski|water ?sport|banana boat|scuba|snorkel|kayak|diving/i.test(t.name || ""))) return "watersports";
  if (/^(attraction|viewpoint|museum|gallery|zoo|theme_park|aquarium)$/.test(t.tourism || "") || t.historic || (amenity === "place_of_worship" && t.wikipedia)) return "sight";
  if (/^(park|nature_reserve|garden)$/.test(t.leisure || "") || /^(waterfall|peak|cave_entrance)$/.test(t.natural || "")) return "nature";
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

async function fetchPois(geo, cats) {
  const [s, w, n, e] = geo.bbox, bb = `(${s},${w},${n},${e})`;
  const key = `poi:${geo.lat.toFixed(3)},${geo.lon.toFixed(3)}:${[...cats].sort().join(",")}`;
  return cached(key, 7 * DAY, async () => {
    const stmts = [...cats].map((c, i) => `(${CATS[c].q.map((q) => q + bb + ";").join("")})->.c${i}; .c${i} out center tags ${CATS[c].limit};`);
    const els = await overpass(`[out:json][timeout:40];${stmts.join("")}`);
    const seen = new Set(), pois = [];
    for (const el of els) {
      const t = el.tags || {};
      const cat = classify(t), lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
      const id = el.type + el.id;
      if (!cat || !t.name || lat == null || seen.has(id)) continue;
      seen.add(id);
      pois.push({
        id, name: t.name, cat, lat, lon, score: score(t, cat),
        viewpoint: t.tourism === "viewpoint", club: t.amenity === "nightclub",
        cuisine: t.cuisine, hours: t.opening_hours, website: t.website || t["contact:website"], wikipedia: t.wikipedia,
      });
    }
    return pois;
  });
}

// ---------- extras: destination blurb + popularity ----------
async function blurb(name) {
  return cached("blurb:" + name.toLowerCase(), 7 * DAY, async () => {
    for (const host of ["en.wikivoyage.org", "en.wikipedia.org"]) {
      try {
        const r = await fetch(`https://${host}/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(name)}`, { headers: { "user-agent": UA } });
        const page = Object.values((await r.json()).query.pages)[0];
        const text = (page.extract || "").replace(/\s*\([^)]*[^\x00-\x7F][^)]*\)/g, "").replace(/\s+/g, " ").trim();
        if (text.length > 60) {
          let out = "";
          for (const sent of text.split(/(?<=[.!?])\s+/)) { if ((out + sent).length > 320 && out) break; out += (out ? " " : "") + sent; }
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

function makePicker(pools) {
  const used = new Set(), names = new Set();
  return (cats, near) => {
    const cand = [];
    for (const c of cats) {
      let n = 0;
      for (const p of pools[c] || []) { if (!used.has(p.id) && !names.has(p.name)) { cand.push(p); if (++n >= 15) break; } }
    }
    if (!cand.length) return null;
    const cost = (p) => (near ? km(near, p) : 0) - 0.6 * p.score;
    const best = near ? cand.reduce((a, b) => (cost(b) < cost(a) ? b : a)) : cand.reduce((a, b) => (b.score > a.score ? b : a));
    used.add(best.id); names.add(best.name);
    return best;
  };
}

function slotFor(p, time, prev, ctx, kind) {
  const parts = [BASE[p.cat]];
  if ((kind === "lunch" || kind === "dinner") && p.cat === "cafe") parts[0] = kind === "lunch" ? "Light lunch." : "Casual dinner.";
  if (p.cuisine) {
    const c = p.cuisine.split(";").slice(0, 3).join(", ").replace(/_/g, " ");
    parts[0] = `${c[0].toUpperCase()}${c.slice(1)} cuisine.`;
  }
  if (p.hours && p.cat !== "beach") parts.push(`Hours: ${p.hours.slice(0, 60)}.`);
  if (ctx.travellers >= 8 && /cafe|restaurant|nightlife/.test(p.cat)) parts.push(`Reserve ahead for ${ctx.travellers} people.`);
  if (prev) { const d = km(prev, p); if (d >= 0.5) parts.push(`About ${d < 10 ? d.toFixed(1) : Math.round(d)} km from the previous stop.`); }
  return {
    time, title: p.name, desc: parts.join(" "), tag: p.cat === "nightlife" ? (p.club ? "Club" : "Bar") : CAT_LABEL[p.cat],
    link: `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=17/${p.lat}/${p.lon}`, website: p.website || undefined,
  };
}

function buildPlan(paceKey, segments, ctx) {
  const pace = PACES[paceKey], days = [], total = ctx.days;
  let dayIdx = 0;
  for (const seg of segments) {
    const pick = makePicker(seg.pools);
    let actI = 0;
    for (let k = 0; k < seg.days; k++, dayIdx++) {
      const first = dayIdx === 0, last = dayIdx === total - 1, arriving = k === 0;
      const nightOK = ctx.interests.includes("nightlife") && (paceKey === "relaxed" ? dayIdx === Math.min(1, total - 1) : !last || total === 1);
      let defs = pace.slots.filter(([, kind]) => (kind === "night" ? nightOK : kind === "cafe" ? ctx.interests.includes("cafe") : true));
      if (total > 1 && (first || arriving)) defs = defs.filter(([t]) => toMin(t) >= (first ? 780 : 720));
      if (total > 1 && last) defs = defs.filter(([t]) => toMin(t) <= 930);
      const slots = [];
      if (first && total > 1) slots.push({ time: "Arrival", title: `Arrive in ${seg.name}`, desc: "Check in, drop bags and freshen up.", tag: "Stay" });
      else if (arriving && !first) slots.push({ time: "Morning", title: `Travel to ${seg.name}`, desc: "Allow half a day for the transfer and check-in.", tag: "Travel" });
      let prev = null; const kinds = [];
      for (const [time, kind] of defs) {
        let p = null;
        if (kind === "breakfast" || kind === "cafe") p = pick(["cafe"], prev) || (kind === "breakfast" ? pick(["restaurant"], prev) : null);
        else if (kind === "lunch" || kind === "dinner") p = pick(["restaurant", "cafe"], prev);
        else if (kind === "night") p = pick(["nightlife"], prev);
        else if (kind === "sunset") p = pick(["beach"], prev) || pick(["sight"].filter(() => true), prev);
        else {
          const acts = ctx.interests.filter((c) => !/^(cafe|restaurant|nightlife)$/.test(c));
          const order = acts.length ? acts : ["sight", "nature"];
          for (let t = 0; t < order.length && !p; t++) p = pick([order[(actI + t) % order.length]], prev);
          actI++;
          if (!p) p = pick(["sight", "nature", "beach"], prev);
        }
        if (!p) continue;
        slots.push(slotFor(p, time, prev, ctx, kind));
        prev = p;
        if (kind === "act" || kind === "sunset") kinds.push(p.cat);
      }
      if (last && total > 1) slots.push({ time: "Afternoon", title: "Head home", desc: "Leave a 3-hour buffer for your airport or station.", tag: "Travel" });
      const themes = [...new Set(kinds)].slice(0, 2).map((c) => ({ beach: "Beaches", watersports: "Watersports", sight: "Sights", nature: "Nature", shopping: "Shopping" }[c])).filter(Boolean);
      const date = new Date(new Date(ctx.start + "T12:00:00").getTime() + dayIdx * DAY).toISOString().slice(0, 10);
      days.push({ day: dayIdx + 1, date, title: `${seg.name}${themes.length ? " · " + themes.join(" & ") : ""}`, slots });
    }
  }
  return { tagline: pace.tagline, days, tips: pace.tips };
}

function groupTips(n, interests) {
  const tips = [];
  if (n >= 10) tips.push(`With ${n} people, reserve restaurants and nightlife a few days ahead; many venues can't seat a group this size on the day.`);
  if (n >= 10) tips.push("Split into two tables or sub-groups if a venue can't take everyone together.");
  if (n >= 9) tips.push("Hire one minibus or tempo traveller for the whole trip instead of many cabs.");
  else if (n >= 5) tips.push(`Plan on about ${Math.ceil(n / 4)} cabs, or hire a larger vehicle for the trip.`);
  if (interests.includes("nightlife") && n >= 6) tips.push("Ask clubs about group entry and cover-charge policies before you go.");
  if (interests.includes("watersports") && n >= 6) tips.push("Book watersports as a group package and negotiate a per-head rate.");
  tips.push("Place data comes from OpenStreetMap; confirm opening hours and prices before you go.");
  return tips;
}

// ---------- entry point ----------
async function plan(input) {
  const interests = parseInterests(input.interests);
  const cats = new Set([...interests, "restaurant", "sight", "beach", "cafe"]);
  const names = input.places;
  const nDays = Math.min(input.days, 14);
  const used = names.slice(0, nDays);

  const segments = [];
  const allPois = [];
  for (const name of used) {
    const geo = await geocode(name);
    if (!geo) throw new Error(`Couldn't find "${name}". Try a more specific name.`);
    const pois = await fetchPois(geo, cats);
    const pools = {};
    for (const p of pois) (pools[p.cat] ||= []).push(p);
    for (const c in pools) pools[c].sort((a, b) => b.score - a.score);
    if (pois.length < 5) throw new Error(`Not enough mapped places found for "${name}".`);
    segments.push({ name, pools });
    allPois.push(...pois);
  }
  const base = Math.floor(nDays / used.length);
  segments.forEach((s, i) => (s.days = base + (i < nDays % used.length ? 1 : 0)));

  const ctx = { days: nDays, start: input.startDate, travellers: input.travellers, interests };
  const plans = {};
  for (const k of Object.keys(PACES)) plans[k] = buildPlan(k, segments, ctx);

  const [intro, trends] = await Promise.all([blurb(used[0]), buildTrends(allPois)]);
  const skipped = names.slice(nDays);
  return {
    destination: used.join(" → "),
    places: used,
    summary: [intro, skipped.length ? `Not enough days to include: ${skipped.join(", ")}.` : ""].filter(Boolean).join(" ") ||
      `A ${nDays}-day plan for ${used.join(", ")}.`,
    trends, groupTips: groupTips(input.travellers, interests), plans,
  };
}

module.exports = { plan };
