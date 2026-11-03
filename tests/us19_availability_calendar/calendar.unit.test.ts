/**
 * US19 — View Venue Availability Calendar (Week 7 changes CR-W7-1, CR-W7-4).
 *
 * Unit tests for lib/venues/calendar.ts: which days each view shows and how a period is worded.
 * The criterion each test covers is in its name.
 */
import { describe, expect, it } from "vitest";
import {
  campusToday,
  clashingPeriods,
  dayHeading,
  moveAnchor,
  periodName,
  periodNotes,
  periodTimes,
  periodsOn,
  rangeLabel,
  visibleDays,
  type CalendarPeriod,
} from "../../lib/venues/calendar";

const MON = "2027-01-04";

function booking(overrides: Partial<CalendarPeriod> = {}): CalendarPeriod {
  return {
    kind: "confirmed",
    start: `${MON}T09:30`,
    end: `${MON}T12:45`,
    event_start: "10:00",
    event_end: "12:00",
    setup_minutes: 30,
    turnaround_minutes: 45,
    hold_expires_at: null,
    event_id: 7,
    event_name: "Gala",
    reason: null,
    note: null,
    ...overrides,
  };
}

function unavailable(overrides: Partial<CalendarPeriod> = {}): CalendarPeriod {
  return booking({
    kind: "unavailable",
    start: `${MON}T08:00`,
    end: `${MON}T20:00`,
    event_start: null,
    event_end: null,
    event_id: null,
    event_name: null,
    reason: "maintenance",
    note: "Floor repairs",
    ...overrides,
  });
}

describe("US19-AC2: navigating by day, week and month", () => {
  it("US19-AC2 the day view shows the one day", () => {
    expect(visibleDays("day", "2027-01-06")).toEqual(["2027-01-06"]);
  });

  it("US19-AC2 the week view runs Monday to Sunday, whichever day it was opened on", () => {
    const week = ["2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07", "2027-01-08", "2027-01-09", "2027-01-10"];
    expect(visibleDays("week", "2027-01-04")).toEqual(week);
    expect(visibleDays("week", "2027-01-10")).toEqual(week);
  });

  it("US19-AC2 the month view is whole weeks covering the month", () => {
    const days = visibleDays("month", "2027-02-15");
    expect(days[0]).toBe("2027-02-01"); // February 2027 starts on a Monday
    expect(days[days.length - 1]).toBe("2027-02-28"); // and ends on a Sunday
    expect(days).toHaveLength(28);
  });

  it("US19-AC2 the month view fills in the days around the month", () => {
    const days = visibleDays("month", "2027-01-15");
    expect(days[0]).toBe("2026-12-28");
    expect(days[days.length - 1]).toBe("2027-01-31");
    expect(days.length % 7).toBe(0);
  });

  it("US19-AC2 the month view handles a leap February", () => {
    expect(visibleDays("month", "2028-02-10")).toContain("2028-02-29");
  });

  it("US19-AC2 stepping moves by one day, week or month", () => {
    expect(moveAnchor("day", "2026-12-31", 1)).toBe("2027-01-01");
    expect(moveAnchor("week", "2027-01-04", -1)).toBe("2026-12-28");
    expect(moveAnchor("month", "2027-01-31", 1)).toBe("2027-02-01");
    expect(moveAnchor("month", "2027-01-15", -1)).toBe("2026-12-01");
  });

  it("US19-AC2 the toolbar names the days shown", () => {
    expect(rangeLabel("day", MON)).toBe("04 Jan 2027");
    expect(rangeLabel("week", "2027-01-06")).toBe("04 Jan 2027 – 10 Jan 2027");
    expect(rangeLabel("month", MON)).toBe("January 2027");
  });

  it("US19-AC2 a column is headed with its weekday and date", () => {
    expect(dayHeading(MON)).toBe("Mon 4");
    expect(dayHeading("2027-01-10")).toBe("Sun 10");
  });

  it("US19-AC2 today is the campus date, 8 hours ahead of UTC", () => {
    expect(campusToday(Date.UTC(2027, 0, 3, 15, 59))).toBe("2027-01-03");
    expect(campusToday(Date.UTC(2027, 0, 3, 16, 0))).toBe("2027-01-04");
  });
});

describe("US19-AC1: what shows on a day", () => {
  it("US19-AC1 a period shows on the days it reaches", () => {
    const period = unavailable({ start: `${MON}T08:00`, end: "2027-01-06T20:00" });
    expect(periodsOn([period], "2027-01-03")).toEqual([]);
    expect(periodsOn([period], MON)).toEqual([period]);
    expect(periodsOn([period], "2027-01-05")).toEqual([period]);
    expect(periodsOn([period], "2027-01-06")).toEqual([period]);
    expect(periodsOn([period], "2027-01-07")).toEqual([]);
  });

  it("US19-AC1 a booking ending exactly at midnight doesn't show on the next day", () => {
    const period = booking({ start: `${MON}T22:00`, end: "2027-01-05T00:00" });
    expect(periodsOn([period], "2027-01-05")).toEqual([]);
  });

  it("US19-AC1 an unavailable period is named by its reason and note", () => {
    expect(periodName(unavailable())).toBe("Maintenance: Floor repairs");
    expect(periodName(unavailable({ note: null }))).toBe("Maintenance");
  });
});

describe("US19-AC3: time ranges include setup and turnaround", () => {
  it("US19-AC3 a booking shows the time it occupies the venue", () => {
    expect(periodTimes(booking())).toBe("09:30–12:45");
  });

  it("US19-AC3 a booking says how that time is made up", () => {
    expect(periodNotes(booking())).toEqual(["Event 10:00–12:00, 30 min setup, 45 min turnaround"]);
  });

  it("US19-AC3 a booking that runs past midnight still shows clock times", () => {
    expect(periodTimes(booking({ start: `${MON}T22:00`, end: "2027-01-05T01:00" }))).toBe("22:00–01:00");
  });

  it("US19-AC3 an unavailable period over several days shows its dates", () => {
    expect(periodTimes(unavailable({ end: "2027-01-06T20:00" }))).toBe("04 Jan 2027, 08:00 – 06 Jan 2027, 20:00");
  });

  it("US19-AC3 an unavailable period within a day shows clock times", () => {
    expect(periodTimes(unavailable())).toBe("08:00–20:00");
    expect(periodNotes(unavailable())).toEqual(["Unavailable"]);
  });
});

describe("US19-AC4: conflicts stand out", () => {
  const clashing = booking({ event_name: "Other", start: `${MON}T12:00`, end: `${MON}T14:00` });

  it("US19-AC4 two bookings needing the venue at once clash, setup and turnaround included", () => {
    const first = booking();
    expect(clashingPeriods([first, clashing])).toEqual(new Set([first, clashing]));
  });

  it("US19-AC4 bookings that only touch don't clash", () => {
    const after = booking({ start: `${MON}T12:45`, end: `${MON}T14:00` });
    expect(clashingPeriods([booking(), after]).size).toBe(0);
  });

  it("US19-AC4 a booking inside an unavailable period clashes, and the period itself isn't marked", () => {
    const first = booking();
    expect(clashingPeriods([first, unavailable()])).toEqual(new Set([first]));
  });

  it("US19-AC6 an expired hold has released the venue, so it clashes with nothing", () => {
    expect(clashingPeriods([booking(), booking({ kind: "expired" })]).size).toBe(0);
  });
});

describe("US19-AC5: details of events the viewer may not see", () => {
  it.each<[CalendarPeriod["kind"], string]>([
    ["confirmed", "Booked"],
    ["pending", "Tentative hold"],
    ["expired", "Released hold"],
  ])("US19-AC5 a %s booking with no event named reads %s", (kind, name) => {
    expect(periodName(booking({ kind, event_id: null, event_name: null }))).toBe(name);
  });

  it("US19-AC5 a booking the viewer may see is named", () => {
    expect(periodName(booking())).toBe("Gala");
  });
});

describe("US19-AC6: tentative holds", () => {
  const expires = "2027-01-02T10:00:00Z"; // 18:00 on campus

  it("US19-AC6 a tentative hold shows when it expires", () => {
    expect(periodNotes(booking({ kind: "pending", hold_expires_at: expires }))).toContain("Held until 02 Jan 2027, 18:00");
  });

  it("US19-AC6 an expired hold shows as released", () => {
    expect(periodNotes(booking({ kind: "expired", hold_expires_at: expires }))[0]).toBe("Released: hold expired 02 Jan 2027, 18:00");
  });

  it("US19-AC6 a hold saved without an expiry still shows sensibly", () => {
    expect(periodNotes(booking({ kind: "pending" }))).toHaveLength(1);
    expect(periodNotes(booking({ kind: "expired" }))[0]).toBe("Released: hold expired");
  });
});
