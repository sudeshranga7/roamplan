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
