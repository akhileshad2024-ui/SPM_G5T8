/** lib/venues/form.ts (US17), lib/venues/search.ts (US20) and lib/venues/suitability.ts (US21). */
import { describe, expect, it } from "vitest";
import { MAX_BUFFER_MINUTES, validateVenueForm, venueFormFrom, venueInputFrom, type VenueFormState } from "../../../lib/venues/form";
import { EMPTY_FILTERS, buildSearchRequest, clearFilter, filterProblem } from "../../../lib/venues/search";
import { buildSuitabilityRequest, eventTiming, unmetChecks } from "../../../lib/venues/suitability";
import type { RequirementCheck, VenueFilterKey, VenueSearchFilters } from "../../../lib/types";
import { makeEvent, makeVenue } from "./fixtures";

describe("venueFormFrom", () => {
  it("starts a new venue with weekday hours and no buffers", () => {
    expect(venueFormFrom()).toEqual({
      name: "", location: "", cap: "", layouts: [], facilities: [], accessibility: [],
      openTime: "08:00", closeTime: "22:00",
      operatingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      setupMinutes: "0", turnaroundMinutes: "0", unavailability: [],
    });
    expect(venueFormFrom(null).name).toBe("");
  });

  it("fills the form from a saved venue, trimming seconds off unavailable periods", () => {
    const form = venueFormFrom(
      makeVenue({
        cap: 80, operatingHours: "09:00 - 17:00", setupMinutes: 15, turnaroundMinutes: 30,
        unavailability: [{ start: "2027-01-04T08:00:00", end: "2027-01-05T08:00:00", reason: "maintenance" }],
      }),
    );
    expect(form).toMatchObject({ cap: "80", openTime: "09:00", closeTime: "17:00", setupMinutes: "15", turnaroundMinutes: "30" });
    expect(form.unavailability[0]).toMatchObject({ start: "2027-01-04T08:00", end: "2027-01-05T08:00" });
  });

  it("uses defaults for whatever an older venue lacks", () => {
    const venue = makeVenue({ operatingHours: "", layouts: undefined, facilities: undefined, accessibility: undefined, operatingDays: undefined, unavailability: undefined, setupMinutes: undefined, turnaroundMinutes: undefined } as never);
    const form = venueFormFrom(venue);
    expect(form).toMatchObject({ openTime: "", closeTime: "22:00", layouts: [], operatingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], setupMinutes: "0" });
  });

  it("falls back to 08:00 when the saved hours split into nothing", () => {
    // A real string always splits into at least one part, so stand in a value whose split() is empty.
    const hours = { split: () => [] } as unknown as string;
    expect(venueFormFrom(makeVenue({ operatingHours: hours }))).toMatchObject({ openTime: "08:00", closeTime: "22:00" });
  });
});

describe("validateVenueForm", () => {
  const valid = (): VenueFormState => ({ ...venueFormFrom(), name: "Hall", location: "Block A", cap: "50" });

  it("accepts a complete form", () => {
    expect(validateVenueForm(valid())).toEqual({});
  });

  it("reports every missing or wrong field", () => {
    const errors = validateVenueForm({
      ...valid(), name: " ", location: "", cap: "0", openTime: "18:00", closeTime: "09:00", operatingDays: [],
      setupMinutes: "x", turnaroundMinutes: String(MAX_BUFFER_MINUTES + 1),
    });
    expect(Object.keys(errors).sort()).toEqual(["cap", "location", "name", "operatingDays", "operatingHours", "setupMinutes", "turnaroundMinutes"]);
  });

  it("rejects a non-numeric capacity", () => {
    expect(validateVenueForm({ ...valid(), cap: "lots" }).cap).toBeDefined();
  });

  it("checks each unavailable period", () => {
    const errors = validateVenueForm({
      ...valid(),
      unavailability: [
        { start: "", end: "2027-01-01T10:00", reason: "maintenance" },
        { start: "2027-01-01T10:00", end: "", reason: "maintenance" },
        { start: "2027-01-01T10:00", end: "2027-01-01T09:00", reason: "maintenance" },
        { start: "2027-01-01T08:00", end: "2027-01-01T09:00", reason: "other", note: " " },
        { start: "2027-01-01T08:00", end: "2027-01-01T09:00", reason: "other" },
        { start: "2027-01-01T08:00", end: "2027-01-01T09:00", reason: "other", note: "Exam" },
      ],
    });
    expect(errors).toEqual({
      "unavailability.0": "Enter a start and an end.",
      "unavailability.1": "Enter a start and an end.",
      "unavailability.2": "The end must be after the start.",
      "unavailability.3": 'Add a note when the reason is "Other".',
      "unavailability.4": 'Add a note when the reason is "Other".',
    });
  });
});

describe("venueInputFrom", () => {
  it("turns the form into the API body, days in week order and blank notes as null", () => {
    const input = venueInputFrom({
      ...venueFormFrom(), name: " Hall ", location: " Block A ", cap: "50", operatingDays: ["Friday", "Monday"],
      setupMinutes: "10", turnaroundMinutes: "20",
      unavailability: [
        { start: "a", end: "b", reason: "maintenance", note: "  " },
        { start: "a", end: "b", reason: "other", note: " Exam " },
        { start: "a", end: "b", reason: "maintenance" },
      ],
    });
    expect(input).toMatchObject({ name: "Hall", location: "Block A", cap: 50, operatingHours: "08:00 - 22:00", operatingDays: ["Monday", "Friday"], setupMinutes: 10, turnaroundMinutes: 20 });
    expect(input.unavailability.map((p) => p.note)).toEqual([null, "Exam", null]);
  });
});

describe("search", () => {
  const full: VenueSearchFilters = {
    date: "2027-01-04", start: "10:00", end: "12:00", attendance: "50", location: "Block A",
    accessibility: ["Wheelchair Access"], layout: "theatre", facilities: ["Stage"],
  };

  it("clears one filter at a time", () => {
    const cases: Array<[VenueFilterKey, Partial<VenueSearchFilters>]> = [
      ["timing", { date: "", start: "", end: "" }],
      ["attendance", { attendance: "" }],
      ["location", { location: "" }],
      ["accessibility", { accessibility: [] }],
      ["layout", { layout: "" }],
      ["facilities", { facilities: [] }],
    ];
    for (const [key, cleared] of cases) expect(clearFilter(full, key)).toEqual({ ...full, ...cleared });
  });

  it("finds no problem with empty or complete filters", () => {
    expect(filterProblem(EMPTY_FILTERS)).toBeNull();
    expect(filterProblem(full)).toBeNull();
  });

  it("wants the date and both times together", () => {
    expect(filterProblem({ ...EMPTY_FILTERS, date: "2027-01-04" })).toBe("Give the date, start time and end time together.");
  });

  it("wants the end after the start", () => {
    expect(filterProblem({ ...full, end: "10:00" })).toBe("The end time must be after the start time.");
  });

  it("wants a whole attendance above 0", () => {
    for (const attendance of ["0", "2.5", "x"]) {
      expect(filterProblem({ ...EMPTY_FILTERS, attendance })).toBe("Expected attendance must be a whole number above 0.");
    }
  });

  it("builds the request from the filters in use", () => {
    expect(buildSearchRequest(EMPTY_FILTERS)).toEqual({ accessibility: [], facilities: [] });
    expect(buildSearchRequest({ ...full, location: "  Block A " })).toEqual({
      date: "2027-01-04", start: "10:00", end: "12:00", attendance: 50, location: "Block A",
      accessibility: ["Wheelchair Access"], layout: "theatre", facilities: ["Stage"],
    });
    expect(buildSearchRequest({ ...EMPTY_FILTERS, location: "   " })).toEqual({ accessibility: [], facilities: [] });
  });
});

describe("suitability", () => {
  it("gives the event's timing when it is set and sensible", () => {
    expect(eventTiming({ date: "4 Jan 2027", start: "10:00", end: "12:00" })).toEqual({ date: "2027-01-04", start: "10:00", end: "12:00" });
  });

  it("gives no timing without a date, with bad times or an end before the start", () => {
    expect(eventTiming({ date: "TBC", start: "10:00", end: "12:00" })).toBeNull();
    expect(eventTiming({ date: "2027-01-04", start: "10", end: "12:00" })).toBeNull();
    expect(eventTiming({ date: "2027-01-04", start: "10:00", end: "1200" })).toBeNull();
    expect(eventTiming({ date: "2027-01-04", start: "12:00", end: "10:00" })).toBeNull();
  });

  it("builds the full request for a saved, timed event", () => {
    expect(buildSuitabilityRequest(makeEvent({ backendId: 3, pax: 80, layout: "banquet", facilities: ["Stage"], access: ["Wheelchair Access"] }))).toEqual({
      attendance: 80, facilities: ["Stage"], accessibility: ["Wheelchair Access"], layout: "banquet", event_id: 3,
      date: "2027-01-04", start: "10:00", end: "12:00",
    });
  });

  it("leaves out what an unsaved, untimed event lacks", () => {
    expect(buildSuitabilityRequest(makeEvent({ backendId: undefined, layout: "" as never, date: "TBC", pax: 10, facilities: [], access: [] }))).toEqual({
      attendance: 10, facilities: [], accessibility: [],
    });
  });

  it("lists the unmet checks, blocking ones first", () => {
    const check = (label: string, met: boolean, severity: "block" | "warn"): RequirementCheck => ({
      key: "facility", label, needed: "", offered: "", met, severity, reason: null,
    });
    const out = unmetChecks([check("ok", true, "block"), check("warn", false, "warn"), check("block", false, "block")]);
    expect(out.map((c) => c.label)).toEqual(["block", "warn"]);
  });
});
