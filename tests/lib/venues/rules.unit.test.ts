/** lib/venues/rules.ts: venue availability rules (Week 7 changes #1 and #2). */
import { describe, expect, it } from "vitest";
import {
  availabilityIssues,
  bookingProblems,
  eventWindow,
  formatClock,
  formatDateTime,
  holdsBooking,
  newlyAffectedBookings,
  occupiedWindow,
  overlaps,
  parseDateTime,
  parseEventDate,
  parseOperatingHours,
  parseTime,
  periodLabel,
  scheduleIssues,
  toIsoDate,
  venueFromApi,
  venueHas,
  weekdayName,
} from "../../../lib/venues/rules";
import type { UnavailabilityReason } from "../../../lib/types";
import { makeApiVenue, makeEvent, makeVenue } from "./fixtures";

const DAY = 24 * 60;
const jan4 = parseEventDate("2027-01-04")!;

describe("parsing and formatting", () => {
  it("reads day-month-year and ISO dates", () => {
    expect(parseEventDate("4 Jan 2027")).toBe(jan4);
    expect(parseEventDate("04 Sept. 2027")).toBe(parseEventDate("2027-09-04"));
    expect(parseEventDate("2027-01-04T10:00")).toBe(jan4);
  });

  it("gives no date for an unknown month or free text", () => {
    expect(parseEventDate("4 Foo 2027")).toBeNull();
    expect(parseEventDate("TBC")).toBeNull();
  });

  it("converts to an ISO date when there is one", () => {
    expect(toIsoDate("4 Jan 2027")).toBe("2027-01-04");
    expect(toIsoDate("TBC")).toBeNull();
  });

  it("reads clock times and rejects impossible ones", () => {
    expect(parseTime("09:30")).toBe(570);
    expect(parseTime(" 9:05 ")).toBe(545);
    expect(parseTime(null)).toBeNull();
    expect(parseTime(undefined)).toBeNull();
    expect(parseTime("noon")).toBeNull();
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("10:60")).toBeNull();
  });

  it("reads date-times, with or without a time", () => {
    expect(parseDateTime("2027-01-04T08:00:00")).toBe(jan4 * DAY + 480);
    expect(parseDateTime("2027-01-04 08:00")).toBe(jan4 * DAY + 480);
    expect(parseDateTime("2027-01-04")).toBe(jan4 * DAY);
    expect(parseDateTime("later")).toBeNull();
  });

  it("formats clock times, wrapping round midnight", () => {
    expect(formatClock(570)).toBe("09:30");
    expect(formatClock(DAY + 60)).toBe("01:00");
    expect(formatClock(-30)).toBe("23:30");
    expect(formatDateTime(jan4 * DAY + 480)).toBe("04 Jan 2027, 08:00");
  });

  it("reads operating hours only when closing is after opening", () => {
    expect(parseOperatingHours("08:00 - 22:00")).toEqual({ open: 480, close: 1320 });
    expect(parseOperatingHours("22:00 - 08:00")).toBeNull();
    expect(parseOperatingHours("08:00")).toBeNull();
    expect(parseOperatingHours(null)).toBeNull();
    expect(parseOperatingHours(undefined)).toBeNull();
  });

  it("names the weekday of a day number", () => {
    expect(weekdayName(0)).toBe("Thursday");
    expect(weekdayName(jan4)).toBe("Monday");
    expect(weekdayName(-1)).toBe("Wednesday");
  });
});

describe("windows", () => {
  it("has no window until the date and times are set", () => {
    expect(eventWindow({ date: "TBC", start: "10:00", end: "12:00" })).toBeNull();
    expect(eventWindow({ date: "2027-01-04", start: "", end: "12:00" })).toBeNull();
    expect(eventWindow({ date: "2027-01-04", start: "10:00", end: "" })).toBeNull();
    expect(occupiedWindow({ date: "TBC", start: "10:00", end: "12:00" }, makeVenue())).toBeNull();
  });

  it("runs past midnight when the end is at or before the start", () => {
    const w = eventWindow({ date: "2027-01-04", start: "22:00", end: "01:00" })!;
    expect(w.end - w.start).toBe(180);
  });

  it("adds setup and turnaround to the occupied window", () => {
    const event = { date: "2027-01-04", start: "10:00", end: "12:00" };
    const base = jan4 * DAY;
    expect(occupiedWindow(event, { setupMinutes: 30, turnaroundMinutes: 15 })).toEqual({ start: base + 570, end: base + 735 });
    expect(occupiedWindow(event, { setupMinutes: 0, turnaroundMinutes: 0 })).toEqual({ start: base + 600, end: base + 720 });
    expect(occupiedWindow(event, {} as never)).toEqual({ start: base + 600, end: base + 720 });
  });

  it("treats touching windows as not overlapping", () => {
    expect(overlaps({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
    expect(overlaps({ start: 0, end: 11 }, { start: 10, end: 20 })).toBe(true);
  });
});

describe("holdsBooking and periodLabel", () => {
  it("counts approved and pending bookings of open events", () => {
    expect(holdsBooking(makeEvent({ bookingState: "approved" }))).toBe(true);
    expect(holdsBooking(makeEvent({ bookingState: "pending" }))).toBe(true);
    expect(holdsBooking(makeEvent({ bookingState: "rejected" }))).toBe(false);
    expect(holdsBooking(makeEvent({ bookingState: "approved", status: "cancelled" }))).toBe(false);
  });

  it("labels a period by its reason and note", () => {
    expect(periodLabel({ start: "", end: "", reason: "maintenance" })).toBe("Maintenance");
    expect(periodLabel({ start: "", end: "", reason: "other", note: "Exams" })).toBe("Other: Exams");
    expect(periodLabel({ start: "", end: "", reason: "flood" as UnavailabilityReason })).toBe("flood");
  });
});

describe("scheduleIssues", () => {
  it("finds nothing for an open venue within its hours", () => {
    expect(scheduleIssues(makeVenue(), makeEvent())).toEqual([]);
  });

  it("blocks a deactivated venue, even without a date", () => {
    expect(scheduleIssues(makeVenue({ isActive: false }), makeEvent({ date: "TBC" }))).toEqual([
      { level: "block", text: "Hall A has been deactivated." },
    ]);
  });

  it("blocks a day the venue is closed", () => {
    const issues = scheduleIssues(makeVenue({ operatingDays: ["Tuesday"] }), makeEvent());
    expect(issues).toEqual([{ level: "block", text: "Hall A is closed on Mondays." }]);
  });

  it("doesn't check days or hours the venue hasn't recorded", () => {
    expect(scheduleIssues(makeVenue({ operatingDays: [], operatingHours: null }), makeEvent({ start: "02:00", end: "03:00" }))).toEqual([]);
  });

  it("blocks an event outside the operating hours", () => {
    expect(scheduleIssues(makeVenue(), makeEvent({ start: "07:00", end: "09:00" }))[0].level).toBe("block");
    expect(scheduleIssues(makeVenue(), makeEvent({ start: "21:00", end: "23:00" }))[0].text).toContain("outside Hall A's operating hours");
  });

  it("warns when only setup or turnaround spills outside the hours", () => {
    const early = scheduleIssues(makeVenue({ setupMinutes: 30 }), makeEvent({ start: "08:00", end: "10:00" }));
    expect(early).toEqual([{ level: "warn", text: "Setup or turnaround (07:30–10:00 incl. 30 min setup) runs outside operating hours (08:00 - 22:00)." }]);
    const late = scheduleIssues(makeVenue({ turnaroundMinutes: 30 }), makeEvent({ start: "20:00", end: "22:00" }));
    expect(late[0].text).toContain("20:00–22:30 incl. 30 min turnaround");
  });
});

describe("availabilityIssues", () => {
  const venue = makeVenue({ id: "V1", setupMinutes: 30, turnaroundMinutes: 30 });
  const event = makeEvent({ id: "E", venue: "V1" });

  it("stops after the schedule checks when the event has no time", () => {
    expect(availabilityIssues([], makeVenue({ isActive: false }), makeEvent({ date: "TBC" }))).toHaveLength(1);
  });

  it("blocks an unavailable period that overlaps, and skips unreadable or separate ones", () => {
    const v = makeVenue({
      unavailability: [
        { start: "bad", end: "2027-01-04T12:00", reason: "maintenance" },
        { start: "2027-01-04T00:00", end: "bad", reason: "maintenance" },
        { start: "2027-01-05T00:00", end: "2027-01-06T00:00", reason: "renovation" },
        { start: "2027-01-04T09:00", end: "2027-01-04T11:00", reason: "safety", note: "Leak" },
      ],
    });
    expect(availabilityIssues([], v, event)).toEqual([
      { level: "block", text: "Hall A is unavailable (Safety concern: Leak) from 04 Jan 2027, 09:00 to 04 Jan 2027, 11:00." },
    ]);
  });

  it("blocks clashes with bookings that hold the venue", () => {
    const booked = makeEvent({ id: "B", name: "Gala", venue: "V1", bookingState: "approved", start: "12:15", end: "14:00" });
    const requested = makeEvent({ id: "R", name: "Mixer", venue: "V1", bookingState: "pending", start: "08:00", end: "09:45" });
    const issues = availabilityIssues([event, booked, requested], venue, event);
    expect(issues.map((i) => i.text)).toEqual([
      "Clashes with Gala, already booked on 2027-01-04 (venue occupied 11:45–14:30 incl. 30 min setup and 30 min turnaround).",
      "Clashes with Mixer, already requested on 2027-01-04 (venue occupied 07:30–10:15 incl. 30 min setup and 30 min turnaround).",
    ]);
  });

  it("describes a clash at a venue without setup or turnaround", () => {
    const bare = makeVenue({ id: "V1" });
    const booked = makeEvent({ id: "B", name: "Gala", venue: "V1", bookingState: "approved" });
    expect(availabilityIssues([booked], bare, event)[0].text).toBe("Clashes with Gala, already booked on 2027-01-04 (venue occupied 10:00–12:00).");
  });

  it("counts only confirmed bookings when asked, and ignores others that can't clash", () => {
    const others = [
      makeEvent({ id: "P", venue: "V1", bookingState: "pending" }),
      makeEvent({ id: "O", venue: "V2", bookingState: "approved" }),
      makeEvent({ id: "N", venue: "V1", bookingState: null }),
      makeEvent({ id: "T", venue: "V1", bookingState: "approved", date: "TBC" }),
      makeEvent({ id: "L", venue: "V1", bookingState: "approved", start: "18:00", end: "19:00" }),
    ];
    expect(availabilityIssues([event, ...others], venue, event, "approved")).toEqual([]);
  });
});

describe("bookingProblems and newlyAffectedBookings", () => {
  const venue = makeVenue({ id: "V1" });
  const held = makeEvent({ id: "H", venue: "V1", bookingState: "approved" });
  const lost = makeEvent({ id: "L", venue: "gone", bookingState: "approved" });
  const free = makeEvent({ id: "F", venue: "V1", bookingState: null });

  it("lists held bookings with blocking problems only", () => {
    const warnOnly = makeEvent({ id: "W", venue: "V2", bookingState: "approved", start: "08:00", end: "09:00" });
    const v2 = makeVenue({ id: "V2", setupMinutes: 30 });
    expect(bookingProblems([held, lost, free, warnOnly], [venue, v2])).toEqual({});
    expect(bookingProblems([held], [makeVenue({ id: "V1", isActive: false })])).toEqual({
      H: [{ level: "block", text: "Hall A has been deactivated." }],
    });
  });

  it("reports only the problems an edit newly caused", () => {
    const closed = makeVenue({ id: "V1", isActive: false });
    const closedMonday = makeVenue({ id: "V1", isActive: false, operatingDays: ["Tuesday"] });

    expect(newlyAffectedBookings([held], [venue], [closed])).toEqual([
      { event: held, issues: [{ level: "block", text: "Hall A has been deactivated." }] },
    ]);
    expect(newlyAffectedBookings([held], [closed], [closedMonday])).toEqual([
      { event: held, issues: [{ level: "block", text: "Hall A is closed on Mondays." }] },
    ]);
    expect(newlyAffectedBookings([held], [closed], [closed])).toEqual([]);
  });
});

describe("venue helpers", () => {
  it("matches list items ignoring case", () => {
    expect(venueHas(["Stage"], "stage")).toBe(true);
    expect(venueHas(["Stage"], "Projector")).toBe(false);
  });

  it("converts an API venue, defaulting the missing lists and buffers", () => {
    expect(venueFromApi(makeApiVenue())).toMatchObject({ id: "1", isActive: true, setupMinutes: 15, lastUpdatedBy: "Venue Staff" });
    const bare = makeApiVenue({
      layouts: undefined, facilities: undefined, accessibility: undefined, operatingHours: undefined,
      operatingDays: undefined, unavailability: undefined, setupMinutes: undefined, turnaroundMinutes: undefined,
    } as never);
    expect(venueFromApi(bare)).toMatchObject({
      layouts: [], facilities: [], accessibility: [], operatingHours: null, operatingDays: [], unavailability: [],
      setupMinutes: 0, turnaroundMinutes: 0,
    });
  });
});
