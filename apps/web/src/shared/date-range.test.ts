import { describe, expect, it } from "vitest";
import {
  monthRangeCoveringDates,
  previousCalendarMonthDateRange,
  previousSalaryCycleDateRange,
  recentMonthRange,
  salaryCycleDateRange,
} from "./date-range";

describe("recentMonthRange", () => {
  it("returns the inclusive range for the most recent six months", () => {
    expect(recentMonthRange(6, new Date(2026, 6, 25))).toEqual({
      from: "2026-02",
      to: "2026-07",
    });
  });

  it("handles a year boundary", () => {
    expect(recentMonthRange(6, new Date(2026, 0, 25))).toEqual({
      from: "2025-08",
      to: "2026-01",
    });
  });
});

describe("salaryCycleDateRange", () => {
  it("starts at the previous payday before this month's payday", () => {
    expect(salaryCycleDateRange(new Date(2026, 8, 29), 31)).toEqual({
      from: "2026-08-31",
      to: "2026-09-29",
    });
  });

  it("clamps month-end payday to shorter months", () => {
    expect(salaryCycleDateRange(new Date(2026, 8, 30), 31)).toEqual({
      from: "2026-09-30",
      to: "2026-09-30",
    });
  });
});

describe("monthRangeCoveringDates", () => {
  it("covers both months needed for a cross-month cash period", () => {
    expect(
      monthRangeCoveringDates({ from: "2026-08-31", to: "2026-09-29" }),
    ).toEqual({ from: "2026-08", to: "2026-09" });
  });
});

describe("previous period ranges", () => {
  it("returns the previous salary cycle", () => {
    expect(previousSalaryCycleDateRange(new Date(2026, 8, 29), 31)).toEqual({
      from: "2026-07-31",
      to: "2026-08-30",
    });
  });

  it("returns the previous calendar month", () => {
    expect(previousCalendarMonthDateRange(new Date(2026, 8, 29))).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });
});
