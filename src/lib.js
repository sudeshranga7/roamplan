export const iso = (d) => d.toISOString().slice(0, 10);
export const localIso = (d = new Date()) => iso(new Date(d.getTime() - d.getTimezoneOffset() * 60000));

export function nextFriday() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  return d;
}

export const fmtDate = (s) =>
  new Date(s + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

// The server streams NDJSON: {"progress": "..."} lines while it works, then {"result": {...}}.
export async function fetchItinerary(input, onProgress = () => {}) {
  const r = await fetch("/api/itinerary", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/x-ndjson" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error || "Something went wrong.");
  }
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.progress) onProgress(msg.progress);
      else if (msg.error) throw new Error(msg.error);
      else if (msg.result) return msg.result;
    }
    if (done) break;
  }
  throw new Error("The connection dropped before the plan arrived. Please try again.");
}

// ---- weather (Open-Meteo, no key needed) ----
const WMO = (c) =>
  c === 0 ? "Clear" : c <= 2 ? "Mostly sunny" : c === 3 ? "Overcast" : c <= 48 ? "Fog" :
  c <= 57 ? "Drizzle" : c <= 67 ? "Rain" : c <= 77 ? "Snow" : c <= 82 ? "Showers" : "Thunderstorms";

export async function getWeather(place, start, days) {
  const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(place)}`)).json();
  const g = geo.results?.[0];
  if (!g) return { place, error: "Not found" };

  const s = new Date(start + "T12:00:00");
  const e = new Date(s); e.setDate(e.getDate() + days - 1);
  const daysAhead = (s - new Date()) / 864e5;
  const q = `latitude=${g.latitude}&longitude=${g.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum&timezone=auto`;
  let url, typical = false;
  if (daysAhead >= -1 && daysAhead + days <= 15) {
    url = `https://api.open-meteo.com/v1/forecast?${q}&start_date=${iso(s)}&end_date=${iso(e)}`;
  } else {
    // Beyond forecast range: same dates last year as a "typical" guide.
    typical = true;
    const ps = new Date(s), pe = new Date(e);
    ps.setFullYear(ps.getFullYear() - 1); pe.setFullYear(pe.getFullYear() - 1);
    url = `https://archive-api.open-meteo.com/v1/archive?${q.replace(",precipitation_probability_max", "")}&start_date=${iso(ps)}&end_date=${iso(pe)}`;
  }
  const d = (await (await fetch(url)).json()).daily;
  if (!d) return { place: g.name, error: "Unavailable" };
  const vals = (a) => a.filter((x) => x != null);
  const avg = (a) => vals(a).reduce((x, y) => x + y, 0) / (vals(a).length || 1);
  return {
    place: g.name, typical,
    hi: Math.round(avg(d.temperature_2m_max)), lo: Math.round(avg(d.temperature_2m_min)),
    rain: d.precipitation_probability_max ? Math.max(0, ...vals(d.precipitation_probability_max)) : null,
    mm: Math.round(vals(d.precipitation_sum).reduce((a, b) => a + b, 0)),
    code: vals(d.weather_code).sort((a, b) => b - a)[0] ?? 0,
    desc: WMO(vals(d.weather_code).sort((a, b) => b - a)[0] ?? 0),
  };
}

// ---- distances and travel time ----
export function km(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Rough estimate from straight-line distance: walk short hops, otherwise road at city speeds.
export function legText(d) {
  if (d < 0.3) return "";
  if (d <= 1.2) return ` About a ${Math.max(3, Math.round(d * 13))}-minute walk from the previous stop.`;
  const mins = Math.round(6 + (d * 1.3 / 25) * 60); // roads wind ~30% more than a straight line
  const t = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60 ? `${mins % 60} min` : ""}`.trim() : `${mins} min`;
  return ` About ${d < 10 ? d.toFixed(1) : Math.round(d)} km away, roughly ${t} by road.`;
}

// ---- edits ----
// An edit for a day is an array of positions: positions[k] is what's shown at slot k's time:
// an original slot index, "3a1" (slot 3's second alternative), or -1 if that time is now empty.
// Times stay put; activities move between them.
export const PACE_KEYS = ["relaxed", "mid", "hectic"];
export const isFixed = (slot) => slot.tag === "Stay" || slot.tag === "Travel"; // arrival / departure rows
export const baseOf = (v) => (typeof v === "number" ? v : parseInt(v, 10));
export const altOf = (v) => (typeof v === "string" ? +v.split("a")[1] : null);

export function positionsFor(day, edit) {
  const n = day.slots.length;
  const ok = (v) => {
    if (v === -1) return true;
    if (Number.isInteger(v)) return v >= 0 && v < n;
    const m = /^(\d+)a(\d+)$/.exec(String(v));
    return !!m && +m[1] < n && +m[2] < (day.slots[+m[1]].alts || []).length;
  };
  const bases = Array.isArray(edit) ? edit.filter((v) => v !== -1).map(baseOf) : [];
  const valid = Array.isArray(edit) && edit.length === n && edit.every(ok) && new Set(bases).size === bases.length;
  return valid ? edit : day.slots.map((_, i) => i);
}

// What's on screen for a day: [{ k, v, s, time }] in time order.
export function rowsFor(day, edit) {
  return positionsFor(day, edit).flatMap((v, k) => {
    if (v === -1) return [];
    const base = day.slots[baseOf(v)], a = altOf(v);
    return [{ k, v, s: a == null ? base : { ...base.alts[a], alts: base.alts }, time: day.slots[k].time }];
  });
}

// Next item in the swap cycle: original → alternative 1 → alternative 2 → original.
export function nextAlt(day, v) {
  const b = baseOf(v), n = (day.slots[b].alts || []).length, a = altOf(v);
  const next = a == null ? 0 : a + 1;
  return next < n ? `${b}a${next}` : b;
}

// ---- share links ----
// ?p=Goa&p=Hampi&d=2026-10-30&n=3&t=16&i=beaches&o=veg&pace=mid&e=mid.0.0,2a1,1,x~hectic.1.…
const encodeEdits = (edits) =>
  Object.entries(edits).flatMap(([pace, days]) =>
    Object.entries(days).map(([d, pos]) => `${pace}.${d}.${pos.map((v) => (v === -1 ? "x" : v)).join(",")}`)).join("~");

function decodeEdits(s) {
  const out = {};
  for (const part of String(s || "").split("~")) {
    const [pace, d, list] = part.split(".");
    if (!PACE_KEYS.includes(pace) || !/^\d+$/.test(d || "") || !list) continue;
    const pos = list.split(",").map((v) => (v === "x" ? -1 : /^\d+$/.test(v) ? +v : /^\d+a\d+$/.test(v) ? v : NaN));
    if (pos.some((v) => Number.isNaN(v))) continue;
    (out[pace] ||= {})[d] = pos;
  }
  return out;
}

const clampInt = (v, lo, hi, dflt) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : dflt;
};
export const PREFS = [["veg", "Vegetarian-friendly"], ["wheelchair", "Wheelchair access"]];

export function readUrl(search = location.search) {
  const q = new URLSearchParams(search);
  const places = q.getAll("p").map((p) => p.trim().slice(0, 80)).filter(Boolean).slice(0, 6);
  if (!places.length) return null;
  return {
    form: {
      places,
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(q.get("d") || "") ? q.get("d") : iso(nextFriday()),
      days: clampInt(q.get("n"), 1, 14, 3),
      travellers: clampInt(q.get("t"), 1, 200, 2),
      interests: (q.get("i") || "").slice(0, 300),
      prefs: (q.get("o") || "").split(",").filter((p) => PREFS.some(([k]) => k === p)),
    },
    pace: PACE_KEYS.includes(q.get("pace")) ? q.get("pace") : "mid",
    edits: decodeEdits(q.get("e")),
  };
}

// The trip part of the URL (no pace/edits): identifies a plan for the offline copy.
export function tripKey(input) {
  const q = new URLSearchParams();
  input.places.forEach((p) => q.append("p", p));
  q.set("d", input.startDate);
  q.set("n", input.days);
  q.set("t", input.travellers);
  if (input.interests) q.set("i", input.interests);
  if (input.prefs?.length) q.set("o", input.prefs.join(","));
  return q;
}

export function writeUrl(input, pace, edits) {
  const q = tripKey(input);
  q.set("pace", pace);
  const e = encodeEdits(edits);
  if (e) q.set("e", e);
  const next = "?" + q.toString();
  if (location.search !== next) history.replaceState(null, "", next);
}

// ---- saved trips (this browser only) ----
// The last few plans are kept so they open offline and appear under "Your recent trips".
const STORE = "roamplan:trips";
export function loadTrips() {
  try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; }
}
export function saveTrip(input, plan) {
  try {
    const key = tripKey(input).toString();
    const trips = [{ key, input, plan, savedAt: Date.now() }, ...loadTrips().filter((t) => t.key !== key)].slice(0, 6);
    localStorage.setItem(STORE, JSON.stringify(trips));
  } catch {} // storage full or blocked: offline copies are a bonus
}
export const findTrip = (input) => loadTrips().find((t) => t.key === tripKey(input).toString());

// ---- calendar export ----
const icsEscape = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/[;,]/g, (c) => "\\" + c).replace(/\r?\n/g, "\\n");
const icsFold = (line) => {
  const out = [];
  let s = line;
  while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); }
  out.push(s);
  return out.join("\r\n");
};
const icsTime = (date, minutes) => {
  const d = new Date(`${date}T00:00:00`);
  d.setMinutes(minutes);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
};

// One event per timed stop, in the traveller's local time (floating, so it follows their phone).
export function buildIcs(plan, pace, edits) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RoamPlan//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsEscape(plan.destination)}`];
  plan.plans[pace].days.forEach((day, i) => {
    const rows = rowsFor(day, edits?.[i]).filter((r) => /^\d{2}:\d{2}$/.test(r.time));
    rows.forEach((r, j) => {
      const start = +r.time.slice(0, 2) * 60 + +r.time.slice(3);
      const next = rows[j + 1] ? +rows[j + 1].time.slice(0, 2) * 60 + +rows[j + 1].time.slice(3) : start + 90;
      const end = Math.min(next, start + 150);
      lines.push("BEGIN:VEVENT", `UID:${day.date}-${r.k}-${Math.random().toString(36).slice(2)}@roamplan`, `DTSTAMP:${stamp}`,
        `DTSTART:${icsTime(day.date, start)}`, `DTEND:${icsTime(day.date, end)}`,
        icsFold(`SUMMARY:${icsEscape(r.s.title)}`), icsFold(`DESCRIPTION:${icsEscape(r.s.desc)}`));
      if (r.s.lat != null) lines.push(`GEO:${r.s.lat};${r.s.lon}`, icsFold(`URL:${r.s.link}`));
      lines.push("END:VEVENT");
    });
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
