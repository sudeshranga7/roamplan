import { describe, expect, it } from "vitest";
import planner from "../planner.js";
const { buildPlan, parseInterests, parsePrefs } = planner;

let id = 0;
const poi = (cat, extra = {}) => ({ id: `n${++id}`, name: `${cat} ${id}`, cat, lat: 15.5 + id * 0.001, lon: 73.8, score: 1, ...extra });
const pools = (spec) => {
  const out = {};
  for (const [cat, n, extra] of spec) out[cat] = Array.from({ length: n }, () => poi(cat, extra));
  out.viewpoint = (out.sight || []).filter((p) => p.viewpoint);
  return out;
};
const ctx = (over = {}) => ({ days: 3, start: "2026-11-06", travellers: 4, interests: parseInterests("beaches, cafes, sights"), prefs: parsePrefs([], ""), ...over });
const titlesOf = (plan) => plan.days.flatMap((d) => d.slots.map((s) => s.title));

describe("buildPlan", () => {
  it("adds arrival and departure rows and plans every day", () => {
    const p = buildPlan("mid", [{ name: "Goa", days: 3, pools: pools([["beach", 10], ["cafe", 10], ["restaurant", 10], ["sight", 10]]) }], ctx());
    expect(p.days).toHaveLength(3);
    expect(p.days[0].slots[0].title).toBe("Arrive in Goa");
    expect(p.days[2].slots.at(-1).title).toBe("Head home");
    expect(new Set(titlesOf(p)).size).toBe(titlesOf(p).length); // nothing repeats
  });

  it("offers alternatives for stops", () => {
    const p = buildPlan("mid", [{ name: "Goa", days: 1, pools: pools([["beach", 10], ["cafe", 10], ["restaurant", 10], ["sight", 10]]) }], ctx({ days: 1 }));
    const withAlts = p.days[0].slots.filter((s) => s.alts?.length);
    expect(withAlts.length).toBeGreaterThan(0);
    expect(withAlts[0].alts[0].title).not.toBe(withAlts[0].title);
  });

  it("skips places that are closed at the slot time", () => {
    const closedAtNight = Array.from({ length: 5 }, () => poi("nightlife", { hours: "Mo-Su 09:00-17:00" }));
    const openLate = poi("nightlife", { hours: "Mo-Su 20:00-03:00", score: 0 });
    const ps = pools([["cafe", 10], ["restaurant", 10], ["sight", 10]]);
    ps.nightlife = [...closedAtNight, openLate];
    const p = buildPlan("mid", [{ name: "Goa", days: 1, pools: ps }], ctx({ days: 1, interests: ["nightlife", "sight"] }));
    const night = p.days[0].slots.find((s) => s.time === "22:00");
    expect(night.title).toBe(openLate.name);
  });

  it("only uses a beach for sunset when beaches are an interest", () => {
    const ps = pools([["beach", 5], ["cafe", 10], ["restaurant", 10], ["sight", 8], ["sight", 2, { viewpoint: true }]]);
    ps.sight = [...pools([["sight", 8]]).sight, ...pools([["sight", 2, { viewpoint: true }]]).sight];
    ps.viewpoint = ps.sight.filter((p) => p.viewpoint);
    const p = buildPlan("mid", [{ name: "Paris", days: 1, pools: ps }], ctx({ days: 1, interests: ["sight", "restaurant"] }));
    const sunset = p.days[0].slots.find((s) => s.time === "17:45");
    expect(sunset.tag).not.toBe("Beach");
  });

  it("keeps rainy days indoors and says so", () => {
    const seg = { name: "Goa", days: 1, pools: pools([["beach", 10], ["cafe", 10], ["restaurant", 10], ["sight", 10]]), rain: { "2026-11-06": { prob: 90, mm: 20 } } };
    const p = buildPlan("mid", [seg], ctx({ days: 1, interests: ["beach", "sight", "cafe"] }));
    expect(p.days[0].note).toMatch(/rain/i);
    expect(p.days[0].slots.some((s) => s.tag === "Beach")).toBe(false);
  });

  it("prefers vegetarian-friendly places when asked", () => {
    const ps = pools([["sight", 10]]);
    ps.cafe = [];
    const here = { lat: 15.5, lon: 73.8 }; // same spot, so only the preference decides
    ps.restaurant = [...Array.from({ length: 6 }, () => poi("restaurant", { score: 3, ...here })), poi("restaurant", { veg: true, score: 0, ...here })];
    const p = buildPlan("relaxed", [{ name: "Goa", days: 1, pools: ps }], ctx({ days: 1, interests: ["sight"], prefs: { veg: true, wheelchair: false } }));
    const lunch = p.days[0].slots.find((s) => s.time === "13:30");
    expect(lunch.desc).toMatch(/Vegetarian options/);
  });
});

describe("preferences", () => {
  it("reads checkboxes and words", () => {
    expect(parsePrefs(["veg"], "")).toEqual({ veg: true, wheelchair: false });
    expect(parsePrefs([], "vegan food, wheelchair accessible")).toEqual({ veg: true, wheelchair: true });
  });
});
