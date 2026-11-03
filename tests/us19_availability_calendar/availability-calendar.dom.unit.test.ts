// @vitest-environment jsdom
/**
 * US19 — the calendar working on a page (components/bookings/AvailabilityCalendar.tsx).
 *
 * Runs the component in jsdom with the server's reply faked, so loading, errors and the controls can be
 * tested on their own. The same steps against the real app are in tests/functional/us19-availability-calendar.spec.ts.
 */
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvailabilityCalendar } from "../../components/bookings/AvailabilityCalendar";
import { ApiError } from "../../lib/api/client";
import type { CalendarPeriod, CalendarVenue } from "../../lib/venues/calendar";

const { apiFetch, app } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  app: { state: { events: [] as unknown[], venues: [] as unknown[] } },
}));

vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));
vi.mock("@/lib/api/client", async (original) => ({ ...(await original<typeof import("../../lib/api/client")>()), apiFetch }));

const MON = "2027-01-04";

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

function venue(id: number, name: string, periods: CalendarPeriod[] = []): CalendarVenue {
  return { id, name, setup_minutes: 30, turnaround_minutes: 45, periods };
}

const THEATRE = venue(1, "Lecture Theatre 1", [period()]);
const STUDIO = venue(2, "Studio", [period({ event_name: "Workshop" })]);

/** A venue with a booking in the following week, the one "Next week" moves to. */
const nextWeek = (name: string) => venue(1, "Lecture Theatre 1", [period({ event_name: name, start: "2027-01-11T09:30", end: "2027-01-11T12:45" })]);

/** A reply the test finishes by hand, to control the order replies arrive in. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const show = () => render(createElement(AvailabilityCalendar));
const lastPath = () => apiFetch.mock.calls[apiFetch.mock.calls.length - 1][0] as string;
const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${MON}T02:00:00Z`)); // 10:00 on Monday, on campus
  app.state = { events: [], venues: [] };
  apiFetch.mockReset();
  apiFetch.mockResolvedValue([THEATRE, STUDIO]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("US19 loading the calendar", () => {
  it("US19-AC1 asks for this week and shows what comes back", async () => {
    show();
    expect(screen.getByText("Loading the calendar…")).toBeTruthy();
    expect(await screen.findByText("Gala")).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith("/venues/availability?start=2027-01-04&end=2027-01-10");
    expect(screen.queryByText("Loading the calendar…")).toBeNull();
  });

  it("US19-AC1 says so when there are no active venues", async () => {
    apiFetch.mockResolvedValue([]);
    show();
    expect(await screen.findByText("No active venues in the catalogue.")).toBeTruthy();
  });

  it("US19 shows the server's message when it refuses", async () => {
    apiFetch.mockRejectedValue(new ApiError(422, "The calendar shows at most 62 days at a time."));
    show();
    expect((await screen.findByRole("alert")).textContent).toBe("The calendar shows at most 62 days at a time.");
  });

  it("US19 explains when the calendar can't be reached", async () => {
    apiFetch.mockRejectedValue(new Error("Network down"));
    show();
    expect((await screen.findByRole("alert")).textContent).toBe("The calendar could not be loaded. Try again.");
  });

  it("US19 clears an error once a later load works", async () => {
    apiFetch.mockRejectedValueOnce(new Error("Network down"));
    apiFetch.mockResolvedValue([nextWeek("Gala Next Week")]);
    show();
    await screen.findByRole("alert");
    press("Next week");
    expect(await screen.findByText("Gala Next Week")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("US19 asks again when the page's events change, so a decision shows straight away", async () => {
    const view = show();
    await screen.findByText("Gala");
    expect(apiFetch).toHaveBeenCalledTimes(1);

    app.state = { ...app.state, events: [{ id: "1" }] };
    view.rerender(createElement(AvailabilityCalendar));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
  });

  it("US19 ignores a slow reply for days no longer shown", async () => {
    const slow = deferred<CalendarVenue[]>();
    apiFetch.mockReturnValueOnce(slow.promise);
    apiFetch.mockResolvedValue([nextWeek("Current")]);
    show();
    press("Next week");
    expect(await screen.findByText("Current")).toBeTruthy();

    // Dated in the week now shown, so it would appear if the late reply were used.
    await act(async () => slow.resolve([nextWeek("Stale")]));
    expect(screen.queryByText("Stale")).toBeNull();
    expect(screen.getByText("Current")).toBeTruthy();
  });

  it("US19 ignores a slow failure for days no longer shown", async () => {
    const slow = deferred<CalendarVenue[]>();
    apiFetch.mockReturnValueOnce(slow.promise);
    apiFetch.mockResolvedValue([nextWeek("Current")]);
    show();
    press("Next week");
    await screen.findByText("Current");

    await act(async () => slow.reject(new Error("Network down")));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("US19 changing the days shown", () => {
  it("US19 shows Loading, not the last range's data, while the next range loads", async () => {
    show();
    await screen.findByText("Gala");
    const slow = deferred<CalendarVenue[]>();
    apiFetch.mockReturnValueOnce(slow.promise);
    press("Next week");
    expect(screen.getByText("Loading the calendar…")).toBeTruthy();
    expect(screen.queryByText("Gala")).toBeNull();
    expect(screen.queryByRole("group", { name: "Lecture Theatre 1 on 2027-01-11" })).toBeNull();

    await act(async () => slow.resolve([nextWeek("Later")]));
    expect(screen.getByText("Later")).toBeTruthy();
  });

  it("US19 shows the error, not an empty grid, when the next range fails", async () => {
    show();
    await screen.findByText("Gala");
    apiFetch.mockRejectedValueOnce(new Error("Network down"));
    press("Next week");
    expect((await screen.findByRole("alert")).textContent).toBe("The calendar could not be loaded. Try again.");
    expect(screen.queryByRole("group", { name: "Lecture Theatre 1 on 2027-01-11" })).toBeNull();
  });
});

describe("US19 holds that expire while the page stays open", () => {
  it("US19 asks again every 15 seconds and shows the hold as released", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(`${MON}T02:00:00Z`));
    apiFetch.mockResolvedValueOnce([venue(1, "Lecture Theatre 1", [period({ kind: "pending", event_name: "Hold", hold_expires_at: `${MON}T10:30` })])]);
    apiFetch.mockResolvedValue([venue(1, "Lecture Theatre 1", [period({ kind: "expired", event_name: "Hold" })])]);
    show();
    expect(await screen.findByLabelText("Pending: Hold")).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(await screen.findByLabelText("Released: Hold")).toBeTruthy();
    expect(screen.queryByLabelText("Pending: Hold")).toBeNull();
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});

describe("US19-AC2 moving around the calendar", () => {
  it("US19-AC2 opens on the week, and switches to the day and the month", async () => {
    show();
    await screen.findByText("Gala");
    expect(screen.getByText("Venue availability · 04 Jan 2027 – 10 Jan 2027")).toBeTruthy();

    press("Day");
    await waitFor(() => expect(lastPath()).toBe("/venues/availability?start=2027-01-04&end=2027-01-04"));
    expect(screen.getByText("Venue availability · 04 Jan 2027")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Day" }).getAttribute("aria-pressed")).toBe("true");

    press("Month");
    await waitFor(() => expect(lastPath()).toBe("/venues/availability?start=2026-12-28&end=2027-01-31"));
    expect(screen.getByText("Venue availability · January 2027")).toBeTruthy();
    expect(await screen.findByRole("group", { name: MON })).toBeTruthy();
  });

  it("US19-AC2 steps forward and back, and returns to today", async () => {
    show();
    await screen.findByText("Gala");

    press("Next week");
    await waitFor(() => expect(lastPath()).toContain("start=2027-01-11"));
    press("Previous week");
    press("Previous week");
    await waitFor(() => expect(lastPath()).toContain("start=2026-12-28"));
    press("Today");
    await waitFor(() => expect(lastPath()).toContain("start=2027-01-04"));
  });

  it("US19-AC2 the step buttons follow the view", async () => {
    show();
    await screen.findByText("Gala");
    press("Month");
    press("Next month");
    await waitFor(() => expect(screen.getByText("Venue availability · February 2027")).toBeTruthy());
  });

  it("US19-AC2 goes to a chosen date", async () => {
    show();
    await screen.findByText("Gala");
    fireEvent.change(screen.getByLabelText("Go to date"), { target: { value: "2027-03-10" } });
    await waitFor(() => expect(lastPath()).toBe("/venues/availability?start=2027-03-08&end=2027-03-14"));
  });

  it("US19-AC2 stays put when the date is cleared", async () => {
    show();
    await screen.findByText("Gala");
    fireEvent.change(screen.getByLabelText("Go to date"), { target: { value: "" } });
    expect((screen.getByLabelText("Go to date") as HTMLInputElement).value).toBe(MON);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});

describe("US19-AC1 choosing a venue", () => {
  it("US19-AC1 lists each venue, and shows all of them to begin with", async () => {
    show();
    await screen.findByText("Gala");
    expect(within(screen.getByLabelText("Venue")).getAllByRole("option").map((o) => o.textContent)).toEqual(["All venues", "Lecture Theatre 1", "Studio"]);
    expect(screen.getByText("Workshop")).toBeTruthy();
  });

  it("US19-AC1 narrows the calendar to one venue, and back", async () => {
    show();
    await screen.findByText("Gala");

    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "2" } });
    expect(screen.queryByText("Gala")).toBeNull();
    expect(screen.getByText("Workshop")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "all" } });
    expect(screen.getByText("Gala")).toBeTruthy();
  });

  it("US19-AC1 the month says which venue each entry is only while several are shown", async () => {
    show();
    await screen.findByText("Gala");
    press("Month");
    const monday = await screen.findByRole("group", { name: MON });
    expect(within(monday).getByText("Lecture Theatre 1")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "1" } });
    expect(within(screen.getByRole("group", { name: MON })).queryByText("Lecture Theatre 1")).toBeNull();
  });
});
