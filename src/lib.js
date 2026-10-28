export const iso = (d) => d.toISOString().slice(0, 10);

export function nextFriday() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  return d;
}

export const fmtDate = (s) =>
  new Date(s + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

export async function fetchItinerary(input) {
  const r = await fetch("/api/itinerary", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Something went wrong.");
  return data;
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
    desc: WMO(vals(d.weather_code).sort((a, b) => b - a)[0] ?? 0),
  };
}

// ---- distances ----
export function km(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---- edits ----
// An edit for a day is an array of positions: positions[k] is the original slot shown at slot k's time,
// or -1 if that time is now empty. Times stay put; activities move between them.
export const PACE_KEYS = ["relaxed", "mid", "hectic"];
export const isFixed = (slot) => slot.tag === "Stay" || slot.tag === "Travel"; // arrival / departure rows

export function positionsFor(day, edit) {
  const n = day.slots.length;
  const valid = Array.isArray(edit) && edit.length === n &&
    edit.every((v) => v === -1 || (Number.isInteger(v) && v >= 0 && v < n)) &&
    new Set(edit.filter((v) => v !== -1)).size === edit.filter((v) => v !== -1).length;
  return valid ? edit : day.slots.map((_, i) => i);
}

// ---- share links ----
// ?p=Goa&p=Hampi&d=2026-10-30&n=3&t=16&i=beaches&pace=mid&e=mid.0.0,2,1,x~hectic.1.…
const encodeEdits = (edits) =>
  Object.entries(edits).flatMap(([pace, days]) =>
    Object.entries(days).map(([d, pos]) => `${pace}.${d}.${pos.map((v) => (v === -1 ? "x" : v)).join(",")}`)).join("~");

function decodeEdits(s) {
  const out = {};
  for (const part of String(s || "").split("~")) {
    const [pace, d, list] = part.split(".");
    if (!PACE_KEYS.includes(pace) || !/^\d+$/.test(d || "") || !list) continue;
    const pos = list.split(",").map((v) => (v === "x" ? -1 : /^\d+$/.test(v) ? +v : NaN));
    if (pos.some(Number.isNaN)) continue;
    (out[pace] ||= {})[d] = pos;
  }
  return out;
}

const clampInt = (v, lo, hi, dflt) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : dflt;
};

export function readUrl() {
  const q = new URLSearchParams(location.search);
  const places = q.getAll("p").map((p) => p.trim().slice(0, 80)).filter(Boolean).slice(0, 6);
  if (!places.length) return null;
  return {
    form: {
      places,
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(q.get("d") || "") ? q.get("d") : iso(nextFriday()),
      days: clampInt(q.get("n"), 1, 14, 3),
      travellers: clampInt(q.get("t"), 1, 200, 2),
      interests: (q.get("i") || "").slice(0, 300),
    },
    pace: PACE_KEYS.includes(q.get("pace")) ? q.get("pace") : "mid",
    edits: decodeEdits(q.get("e")),
  };
}

export function writeUrl(input, pace, edits) {
  const q = new URLSearchParams();
  input.places.forEach((p) => q.append("p", p));
  q.set("d", input.startDate);
  q.set("n", input.days);
  q.set("t", input.travellers);
  if (input.interests) q.set("i", input.interests);
  q.set("pace", pace);
  const e = encodeEdits(edits);
  if (e) q.set("e", e);
  history.replaceState(null, "", "?" + q.toString());
}
