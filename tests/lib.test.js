import { describe, expect, it } from "vitest";
import { buildIcs, legText, nextAlt, positionsFor, readUrl, rowsFor, tripKey } from "../src/lib.js";

const day = {
  date: "2026-11-06",
  slots: [
    { time: "Arrival", title: "Arrive in Goa", tag: "Stay" },
    { time: "13:30", title: "Lunch spot", tag: "Food", lat: 15.5, lon: 73.8, link: "x", alts: [{ title: "Alt A" }, { title: "Alt B" }] },
    { time: "17:45", title: "Beach", tag: "Beach", lat: 15.51, lon: 73.8, link: "y" },
  ],
};

describe("edits", () => {
  it("ignores invalid edits", () => {
    expect(positionsFor(day, [0, 1])).toEqual([0, 1, 2]); // wrong length
    expect(positionsFor(day, [0, 1, 1])).toEqual([0, 1, 2]); // duplicate
    expect(positionsFor(day, [0, "1a5", 2])).toEqual([0, 1, 2]); // no such alternative
    expect(positionsFor(day, [0, 2, 1])).toEqual([0, 2, 1]);
  });
  it("shows swapped stops at fixed times", () => {
    const rows = rowsFor(day, [0, 2, 1]);
    expect(rows.map((r) => `${r.time} ${r.s.title}`)).toEqual(["Arrival Arrive in Goa", "13:30 Beach", "17:45 Lunch spot"]);
  });
  it("cycles alternatives and back", () => {
    expect(nextAlt(day, 1)).toBe("1a0");
    expect(nextAlt(day, "1a0")).toBe("1a1");
    expect(nextAlt(day, "1a1")).toBe(1);
    expect(rowsFor(day, [0, "1a1", 2])[1].s.title).toBe("Alt B");
  });
  it("hides removed stops", () => {
    expect(rowsFor(day, [0, -1, 2]).map((r) => r.s.title)).toEqual(["Arrive in Goa", "Beach"]);
  });
});

describe("share links", () => {
  it("round-trips a trip with edits", () => {
    const input = { places: ["Kyoto", "Osaka"], startDate: "2026-11-10", days: 4, travellers: 2, interests: "food", prefs: ["veg"] };
    const q = tripKey(input);
    q.set("pace", "hectic");
    q.set("e", "hectic.1.0,2a1,x");
    const back = readUrl("?" + q.toString());
    expect(back.form).toEqual(input);
    expect(back.pace).toBe("hectic");
    expect(back.edits).toEqual({ hectic: { 1: [0, "2a1", -1] } });
  });
  it("clamps bad values and drops junk", () => {
    const back = readUrl("?p=Goa&n=99&t=-5&d=nope&pace=wild&o=veg,hack&e=evil");
    expect(back.form.days).toBe(14);
    expect(back.form.travellers).toBe(1);
    expect(back.form.prefs).toEqual(["veg"]);
    expect(back.pace).toBe("mid");
    expect(back.edits).toEqual({});
    expect(readUrl("?d=2026-01-01")).toBe(null);
  });
});

describe("travel time", () => {
  it("walks short hops and drives long ones", () => {
    expect(legText(0.1)).toBe("");
    expect(legText(0.8)).toMatch(/minute walk/);
    expect(legText(12)).toMatch(/12 km away, roughly \d+ min by road/);
  });
});

describe("calendar export", () => {
  it("writes one event per timed stop", () => {
    const plan = { destination: "Goa", plans: { mid: { days: [day] } } };
    const ics = buildIcs(plan, "mid", undefined);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2); // "Arrival" has no clock time
    expect(ics).toContain("DTSTART:20261106T133000");
    expect(ics).toContain("DTEND:20261106T160000"); // capped at 2.5 h even though the next stop is later
    expect(ics).toContain("DTSTART:20261106T174500");
    expect(ics).toContain("SUMMARY:Lunch spot");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
  });
});
