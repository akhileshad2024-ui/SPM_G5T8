/**
 * US19 — what the calendar renders (components/bookings/AvailabilityCalendar.tsx).
 *
 * Renders the grids to HTML with the periods the server would send. Loading them and pressing the
 * buttons need a browser: see tests/functional/us19-availability-calendar.spec.ts.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AvailabilityCalendar, MonthGrid, VenueRows } from "../../components/bookings/AvailabilityCalendar";
import CalendarPage from "../../app/(dashboard)/calendar/page";
import type { CalendarPeriod, CalendarVenue } from "../../lib/venues/calendar";

vi.mock("@/lib/state/app-context", () => ({ useApp: () => ({ state: { events: [], venues: [] } }) }));

const MON = "2027-01-04";
const TUE = "2027-01-05";

function period(overrides: Partial<CalendarPeriod> = {}): CalendarPeriod {
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

function venue(periods: CalendarPeriod[], overrides: Partial<CalendarVenue> = {}): CalendarVenue {
  return { id: 1, name: "Lecture Theatre 1", setup_minutes: 30, turnaround_minutes: 45, periods, ...overrides };
}

const rows = (venues: CalendarVenue[], days: string[]) => renderToStaticMarkup(createElement(VenueRows, { venues, days }));
const month = (venues: CalendarVenue[], days: string[]) => renderToStaticMarkup(createElement(MonthGrid, { venues, days, month: "2027-01" }));

describe("US19 venue rows (day and week views)", () => {
  it("US19-AC1 shows each venue with its setup and turnaround settings", () => {
    const html = rows([venue([])], [MON]);
    expect(html).toContain("Lecture Theatre 1");
    expect(html).toContain("+30/45 min");
  });

  it("US19-AC2 heads a column for each day", () => {
    const html = rows([venue([])], [MON, TUE]);
    expect(html).toContain("Mon 4");
    expect(html).toContain("Tue 5");
  });

  it("US19-AC1 puts a booking in its own day's cell, labelled for that venue and day", () => {
    const html = rows([venue([period()])], [MON, TUE]);
    const monday = html.slice(html.indexOf(`aria-label="Lecture Theatre 1 on ${MON}"`), html.indexOf(`aria-label="Lecture Theatre 1 on ${TUE}"`));
    expect(monday).toContain("Gala");
    expect(html.slice(html.indexOf(`aria-label="Lecture Theatre 1 on ${TUE}"`))).not.toContain("Gala");
  });

  it("US19-AC3 shows the occupied time and how it is made up", () => {
    const html = rows([venue([period()])], [MON]);
    expect(html).toContain("09:30–12:45");
    expect(html).toContain("Event 10:00–12:00, 30 min setup, 45 min turnaround");
  });

  it.each<[CalendarPeriod["kind"], string]>([
    ["confirmed", "Confirmed: Gala"],
    ["pending", "Pending: Gala"],
    ["expired", "Released: Gala"],
  ])("US19-AC4 a %s booking is labelled by its kind", (kind, label) => {
    expect(rows([venue([period({ kind })])], [MON])).toContain(`aria-label="${label}"`);
  });

  it("US19-AC4 an unavailable period is labelled as unavailable", () => {
    const blocked = period({ kind: "unavailable", start: `${MON}T08:00`, end: `${MON}T20:00`, reason: "maintenance", note: null, event_name: null });
    expect(rows([venue([blocked])], [MON])).toContain('aria-label="Unavailable: Maintenance"');
  });

  it("US19-AC4 each kind of period gets its own look", () => {
    const looks = (["confirmed", "pending", "expired"] as const).map((kind) => {
      const html = rows([venue([period({ kind })])], [MON]);
      return /class="([^"]*)" aria-label="[A-Z]/.exec(html)![1];
    });
    expect(new Set(looks).size).toBe(3);
  });

  it("US19-AC4 clashing bookings get the conflict look instead", () => {
    const other = period({ event_name: "Other", start: `${MON}T12:00`, end: `${MON}T14:00` });
    const clashing = rows([venue([period(), other])], [MON]);
    const clear = rows([venue([period()])], [MON]);
    const lookOf = (html: string) => /class="([^"]*)" aria-label="Confirmed: Gala"/.exec(html)![1];
    expect(lookOf(clashing)).not.toBe(lookOf(clear));
  });

  it("US19-AC5 a booking the viewer may not see reads only as booked", () => {
    const html = rows([venue([period({ event_id: null, event_name: null })])], [MON]);
    expect(html).toContain('aria-label="Confirmed: Booked"');
  });
});

describe("US19 month grid", () => {
  it("US19-AC2 heads the columns Monday to Sunday and numbers the days", () => {
    const html = month([venue([])], [MON]);
    expect(html.indexOf(">Mon<")).toBeLessThan(html.indexOf(">Sun<"));
    expect(html).toContain(`aria-label="${MON}"`);
    expect(html).toContain(">4<");
  });

  it("US19-AC2 dims days outside the month", () => {
    const html = month([venue([])], ["2026-12-31", MON]);
    const classOf = (day: string) => new RegExp(`class="([^"]*)" role="group" aria-label="${day}"`).exec(html)![1];
    expect(classOf("2026-12-31")).not.toBe(classOf(MON));
  });

  it("US19-AC1 says which venue each entry is when several are shown", () => {
    const html = month([venue([period()]), venue([], { id: 2, name: "Studio" })], [MON]);
    expect(html).toContain("Gala");
    expect(html).toContain("Lecture Theatre 1");
    expect(html).not.toContain("+30/45 min");
  });

  it("US19-AC1 leaves the venue out when only one is shown", () => {
    expect(month([venue([period()])], [MON])).not.toContain("Lecture Theatre 1");
  });
});

describe("US19 calendar shell", () => {
  it("US19-AC2 offers day, week and month, starting on the week", () => {
    const html = renderToStaticMarkup(createElement(AvailabilityCalendar));
    expect(html).toContain('aria-label="Calendar view"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Week</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Day</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Month</);
  });

  it("US19-AC2 offers stepping, today, a date to go to and a choice of venue", () => {
    const html = renderToStaticMarkup(createElement(AvailabilityCalendar));
    for (const label of ["Previous week", "Next week", "Go to date", "Venue"]) expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain(">Today<");
    expect(html).toContain("All venues");
  });

  it("US19-AC4 explains each kind of period in the legend", () => {
    const html = renderToStaticMarkup(createElement(AvailabilityCalendar));
    for (const label of ["Confirmed", "Pending", "Unavailable", "Released (hold expired)"]) expect(html).toContain(label);
  });

  it("US19 says it is loading before the server has answered", () => {
    expect(renderToStaticMarkup(createElement(AvailabilityCalendar))).toContain("Loading the calendar");
  });

  it("US19 the Venue calendar page shows the calendar", () => {
    expect(renderToStaticMarkup(createElement(CalendarPage))).toContain("Venue availability");
  });
});
