import { describe, expect, it } from "vitest";
import planner from "../planner.js";
const { openAt } = planner;

const MON = 0, FRI = 4, SAT = 5, SUN = 6;
const t = (hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3);

describe("openAt", () => {
  it("handles 24/7", () => {
    expect(openAt("24/7", SUN, t("03:00"))).toBe(true);
  });
  it("handles day ranges and multiple rules", () => {
    const s = "Mo-Fr 09:00-18:00; Sa 10:00-14:00";
    expect(openAt(s, MON, t("10:00"))).toBe(true);
    expect(openAt(s, MON, t("19:00"))).toBe(false);
    expect(openAt(s, SAT, t("13:59"))).toBe(true);
    expect(openAt(s, SAT, t("15:00"))).toBe(false);
    expect(openAt(s, SUN, t("12:00"))).toBe(false); // not listed = closed
  });
  it("handles opening past midnight", () => {
    const s = "Tu-Su 18:00-02:00";
    expect(openAt(s, SAT, t("23:30"))).toBe(true);
    expect(openAt(s, SUN, t("01:00"))).toBe(true); // Saturday night carrying over
    expect(openAt(s, MON, t("01:00"))).toBe(true); // Sunday night carrying over
    expect(openAt(s, MON, t("20:00"))).toBe(false);
  });
  it("handles split hours, lists and off", () => {
    expect(openAt("Mo,We,Fr 08:00-12:00,16:00-20:00", FRI, t("17:00"))).toBe(true);
    expect(openAt("Mo,We,Fr 08:00-12:00,16:00-20:00", FRI, t("13:00"))).toBe(false);
    expect(openAt("Mo-Su 10:00-22:00; Mo off", MON, t("12:00"))).toBe(false);
  });
  it("applies a rule without days to every day", () => {
    expect(openAt("10:00-23:00", SUN, t("11:00"))).toBe(true);
  });
  it("returns null for missing or unusual text", () => {
    expect(openAt(undefined, MON, 600)).toBe(null);
    expect(openAt("sunrise-sunset", MON, 600)).toBe(null);
    expect(openAt("Mo-Fr 09:00-17:00; PH off", MON, 600)).toBe(null);
  });
});
