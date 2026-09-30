export interface MonthRange {
  from: string;
  to: string;
}

export interface CalendarDateRange {
  from: string;
  to: string;
}

export const salaryDayStorageKey = "taiwan-fin-hub-salary-day";

export function recentMonthRange(count: number, now = new Date()): MonthRange {
  return monthRangeEndingAt(monthKey(now), count);
}

export function monthRangeEndingAt(month: string, count: number): MonthRange {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(year, monthNumber - count, 1);
  return {
    from: monthKey(start),
    to: month,
  };
}

export function recentMonthKeys(count: number, now = new Date()) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(
      now.getFullYear(),
      now.getMonth() - count + 1 + index,
      1,
    );
    return monthKey(date);
  });
}

/**
 * Returns the current cash-flow period anchored to the user's payday.
 * Day 31 means "the last day of the month" when a month has fewer days.
 */
export function salaryCycleDateRange(
  now = new Date(),
  salaryDay = 31,
): CalendarDateRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisPayday = dateAtMonth(now.getFullYear(), now.getMonth(), salaryDay);
  const start =
    today >= thisPayday
      ? thisPayday
      : dateAtMonth(now.getFullYear(), now.getMonth() - 1, salaryDay);

  return {
    from: dateKey(start),
    to: dateKey(today),
  };
}

export function previousSalaryCycleDateRange(
  now = new Date(),
  salaryDay = 31,
): CalendarDateRange {
  const current = salaryCycleDateRange(now, salaryDay);
  const previousEnd = dateFromKey(current.from);
  previousEnd.setDate(previousEnd.getDate() - 1);
  return salaryCycleDateRange(previousEnd, salaryDay);
}

export function previousCalendarMonthDateRange(
  now = new Date(),
): CalendarDateRange {
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: dateKey(first), to: dateKey(last) };
}

export function monthRangeCoveringDates(range: CalendarDateRange): MonthRange {
  return {
    from: range.from.slice(0, 7),
    to: range.to.slice(0, 7),
  };
}

export function readSalaryDay(defaultDay = 31) {
  if (typeof window === "undefined") return defaultDay;
  const value = Number(window.localStorage.getItem(salaryDayStorageKey));
  return Number.isInteger(value) && value >= 1 && value <= 31
    ? value
    : defaultDay;
}

export function persistSalaryDay(day: number) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(salaryDayStorageKey, String(day));
  }
}

export function salaryDayLabel(day: number) {
  return day === 31 ? "月底" : `每月 ${day} 日`;
}

function dateAtMonth(year: number, monthIndex: number, day: number) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(Math.max(day, 1), lastDay));
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
