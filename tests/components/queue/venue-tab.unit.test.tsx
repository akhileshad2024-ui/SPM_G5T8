// @vitest-environment jsdom
// The coordinator's Venue tab: this event's bookings, replacing a flagged one, and requesting a new venue.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { VenueTab } from "../../../components/queue/tabs/VenueTab";
import type { RequirementCheck, VenueBookingRecord, VenueSuitability } from "../../../lib/types";
import { fakeApp } from "../../helpers/fake-app";
import { makeBooking, makeEvent } from "../../pages/fixtures";

const api = vi.hoisted(() => vi.fn());
const problems = vi.hoisted(() => ({ value: {} as Record<string, Array<{ text: string }>> }));
vi.mock("@/lib/api/client", () => ({ apiFetch: api }));
vi.mock("@/lib/venues/rules", async (original) => ({ ...(await original<typeof import("../../../lib/venues/rules")>()), bookingProblems: () => problems.value }));
let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));

const makeVenue = (id: string, over = {}) => ({
  id, name: `Hall ${id}`, location: "Main campus", cap: 200, layouts: ["theatre", "banquet"], facilities: ["Stage"], accessibility: ["Wheelchair Access"],
  operatingHours: null, operatingDays: [], unavailability: [], setupMinutes: 30, turnaroundMinutes: 15, isActive: true,
  lastUpdatedBy: null, lastUpdatedAt: null, ...over,
});
const check = (over: Partial<RequirementCheck> = {}): RequirementCheck => ({ key: "capacity", label: "Capacity", needed: "120", offered: "200", met: true, severity: "block", reason: null, ...over });
const suit = (id: number, verdict: VenueSuitability["verdict"], checks: RequirementCheck[] = [check()]) => ({ venue: { id } as never, verdict, checks });
const answer = (...results: ReturnType<typeof suit>[]) => api.mockResolvedValue({ results });
const booking = (over: Partial<VenueBookingRecord> = {}) => makeBooking({ venue_id: 9, venue_name: "Hall Nine", ...over });

function setUp(event = makeEvent({ backendId: 1, status: "approved" }), over: Parameters<typeof fakeApp>[0] = {}, venues = [makeVenue("1")]) {
  app = fakeApp({
    state: { role: "coordinator", venues: venues as never, events: [event] },
    venue: (id?: string | null) => venues.find((v) => v.id === id) as never,
    requestBooking: vi.fn().mockResolvedValue(true), changeBooking: vi.fn().mockResolvedValue({ ok: true }),
    cancelBooking: vi.fn().mockResolvedValue(undefined), cancelAllBookings: vi.fn().mockResolvedValue(undefined), ...over,
  });
  return render(<VenueTab event={event} />);
}
const card = (name: string) => screen.getByText(name, { selector: "span" }).closest(".card") as HTMLElement;
const newBooking = () => within(screen.getByLabelText("New booking"));

beforeEach(() => { api.mockReset(); problems.value = {}; answer(suit(1, "suitable")); });

// ---------------------------------------------------------------- the venue list

it("checks every venue against the event, then shows each venue's details and verdict", async () => {
  let release!: (v: unknown) => void;
  api.mockReturnValue(new Promise((a) => { release = a; }));
  setUp();
  expect(screen.getByText("Checking each venue against this event's needs…")).toBeTruthy();
  await act(async () => release({ results: [suit(1, "suitable")] }));
  expect(screen.queryByText(/^Checking each venue/)).toBeNull();
  expect(screen.getByText("Hall 1")).toBeTruthy();
  expect(screen.getByText("Suitable")).toBeTruthy();
  expect(screen.getByText("Main campus · capacity 200 · 30 min setup · 15 min turnaround")).toBeTruthy();
  expect(screen.getAllByText("Theatre").length).toBeGreaterThan(0); // a tag, and an option in the layout lists
  expect(screen.getByText("Stage")).toBeTruthy();
  expect(screen.getByText("Wheelchair Access")).toBeTruthy();
  expect(screen.getByText("Goes to Venue Staff for approval")).toBeTruthy();
  const [url, options] = api.mock.calls[0];
  expect(url).toBe("/venues/suitability");
  expect(JSON.parse(options.body)).toMatchObject({ attendance: 120, layout: "theatre", event_id: 1, date: "2027-01-04", start: "10:00", end: "12:00" });
});

it("shows what is not met, the serious problems first, and a comparison table", async () => {
  answer(suit(1, "partially_suitable", [
    check({ label: "Capacity", needed: "300", offered: "200", met: false, severity: "warn", reason: "Too small by 100." }),
    check({ label: "Layout", needed: "boardroom", offered: "theatre", met: false, severity: "block", reason: "No boardroom layout." }),
    check({ label: "Facilities", needed: "Stage", offered: "Stage", met: true }),
  ]));
  setUp();
  await screen.findByText("Partially suitable");
  const reasons = ["No boardroom layout.", "Too small by 100."].map((t) => screen.getByText(t));
  expect(reasons[0].compareDocumentPosition(reasons[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("Compared with this event's venue needs")).toBeTruthy();
  const rows = screen.getAllByRole("row").slice(1);
  expect(rows.map((r) => r.lastElementChild!.textContent)).toEqual(["No", "No", "Yes"]);
  expect(screen.getByText("Needs your acknowledgement of the warning")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Request anyway…" })).toBeTruthy();
});

it("leaves out a venue the check did not answer for, and says nothing while the check is still empty-handed", async () => {
  answer(suit(2, "suitable"));
  setUp(undefined, {}, [makeVenue("1"), makeVenue("2")]);
  await screen.findByText("Hall 2");
  expect(screen.queryByText("Hall 1")).toBeNull();
});

it("does not ask the server anything while the venue catalogue is empty", () => {
  setUp(undefined, {}, []);
  expect(api).not.toHaveBeenCalled();
  expect(screen.getByText("0 of 0 venues match")).toBeTruthy();
});

it("hands a failed check to the app's error handling and stops showing 'Checking'", async () => {
  api.mockRejectedValue(new Error("offline"));
  setUp();
  await waitFor(() => expect(app.handleApiError).toHaveBeenCalled());
  expect(screen.queryByText(/^Checking each venue/)).toBeNull();
});

it("ignores a check that finishes after the tab is closed", async () => {
  let release!: (v: unknown) => void;
  let fail!: (e: unknown) => void;
  api.mockReturnValueOnce(new Promise((a) => { release = a; })).mockReturnValueOnce(new Promise((_a, b) => { fail = b; }));
  setUp().unmount();
  setUp().unmount();
  await act(async () => { release({ results: [suit(1, "suitable")] }); fail(new Error("late")); });
  expect(app.handleApiError).not.toHaveBeenCalled();
});

it("asks again when the venue needs change", async () => {
  setUp();
  await screen.findByText("Hall 1");
  fireEvent.change(newBooking().getByLabelText("Attendance"), { target: { value: "80" } });
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  expect(JSON.parse(api.mock.calls[1][1].body).attendance).toBe(80);
  fireEvent.change(newBooking().getByLabelText("Layout"), { target: { value: "banquet" } });
  await waitFor(() => expect(api).toHaveBeenCalledTimes(3));
  expect(JSON.parse(api.mock.calls[2][1].body).layout).toBe("banquet");
});

// ---------------------------------------------------------------- the filters

it("narrows the list by the capacity and layout filters", async () => {
  answer(suit(1, "suitable"), suit(2, "suitable"), suit(3, "suitable"));
  const venues = [makeVenue("1"), makeVenue("2", { cap: 100 }), makeVenue("3", { layouts: ["classroom"] }), makeVenue("4", { isActive: false })];
  const event = makeEvent({ backendId: 1, status: "approved" });
  app = fakeApp({ state: { role: "coordinator", vf: { cap: "150", layout: "banquet" }, venues: venues as never, events: [event] }, venue: () => undefined as never });
  render(<VenueTab event={event} />);
  await screen.findByText("Hall 1");
  expect(screen.queryByText("Hall 2")).toBeNull(); // below the minimum capacity
  expect(screen.queryByText("Hall 3")).toBeNull(); // no banquet layout
  expect(screen.getByText("1 of 3 venues match")).toBeTruthy(); // the inactive venue is not counted
});

it("treats a blank or unreadable minimum capacity as no minimum", async () => {
  app = fakeApp({ state: { role: "coordinator", vf: { cap: "abc", layout: "any" }, venues: [makeVenue("1", { cap: 5 })] as never, events: [] }, venue: () => undefined as never });
  render(<VenueTab event={makeEvent({ backendId: 1, status: "approved" })} />);
  await screen.findByText("Hall 1");
});

it("passes the filter changes to the app", async () => {
  setUp();
  await screen.findByText("Hall 1");
  fireEvent.change(screen.getByDisplayValue("180"), { target: { value: "50" } });
  expect(app.setVfCap).toHaveBeenCalledWith("50");
  fireEvent.change(screen.getByDisplayValue("Any layout"), { target: { value: "theatre" } });
  expect(app.setVfLayout).toHaveBeenCalledWith("theatre");
});

// ---------------------------------------------------------------- requesting a venue

it("requests a suitable venue straight away with the event's own needs", async () => {
  setUp();
  await screen.findByText("Hall 1");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Request booking" })); });
  expect(app.requestBooking).toHaveBeenCalledWith(expect.any(String), "1", false, { attendance: undefined, layout: undefined, purpose: "", replaces: undefined });
});

it("sends a booking's own attendance, layout and purpose when they differ from the event's", async () => {
  setUp();
  await screen.findByText("Hall 1");
  fireEvent.change(newBooking().getByLabelText("Purpose"), { target: { value: "Breakout session" } });
  fireEvent.change(newBooking().getByLabelText("Attendance"), { target: { value: "40" } });
  fireEvent.change(newBooking().getByLabelText("Layout"), { target: { value: "boardroom" } });
  await screen.findByText("Hall 1");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Request booking" })); });
  expect(app.requestBooking).toHaveBeenCalledWith(expect.any(String), "1", false, { attendance: 40, layout: "boardroom", purpose: "Breakout session", replaces: undefined });
  // After a saved request the form returns to the event's own needs.
  expect((newBooking().getByLabelText("Attendance") as HTMLInputElement).value).toBe("120");
  expect((newBooking().getByLabelText("Purpose") as HTMLInputElement).value).toBe("");
});

it("starts with an empty attendance for an event with no expected attendance, and sends none", async () => {
  setUp(makeEvent({ backendId: 1, status: "approved", pax: 0 }));
  await screen.findByText("Hall 1");
  expect((newBooking().getByLabelText("Attendance") as HTMLInputElement).value).toBe("");
});

it("keeps the form as it was when the request is refused", async () => {
  setUp(undefined, { requestBooking: vi.fn().mockResolvedValue(false) });
  await screen.findByText("Hall 1");
  fireEvent.change(newBooking().getByLabelText("Purpose"), { target: { value: "Overflow" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Request booking" })); });
  expect((newBooking().getByLabelText("Purpose") as HTMLInputElement).value).toBe("Overflow");
});

it("asks for an acknowledgement before requesting a venue that is not fully suitable", async () => {
  answer(suit(1, "unsuitable", [check({ met: false, severity: "block", reason: "Too small." })]));
  setUp();
  await screen.findByText("Hall 1");
  fireEvent.click(screen.getByRole("button", { name: "Request anyway…" }));
  expect(screen.getByRole("alert").textContent).toContain("Hall 1 is unsuitable for this event.");
  const confirm = screen.getByRole("button", { name: "Request booking anyway" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(confirm.disabled).toBe(false);
  await act(async () => { fireEvent.click(confirm); });
  expect(app.requestBooking).toHaveBeenCalledWith(expect.any(String), "1", true, expect.any(Object));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("closes the warning when Cancel is pressed, and asks for the tick again next time", async () => {
  answer(suit(1, "partially_suitable", [check({ met: false, severity: "warn", reason: "Small." })]));
  setUp();
  await screen.findByText("Hall 1");
  fireEvent.click(screen.getByRole("button", { name: "Request anyway…" }));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Request anyway…" }));
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
});

it("shows 'Requesting…' and disables the buttons while an override is being requested", async () => {
  let finish!: (v: boolean) => void;
  answer(suit(1, "unsuitable", [check({ met: false, reason: "Too small." })]));
  setUp(undefined, { requestBooking: vi.fn(() => new Promise<boolean>((a) => { finish = a; })) });
  await screen.findByText("Hall 1");
  fireEvent.click(screen.getByRole("button", { name: "Request anyway…" }));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Request booking anyway" }));
  expect(screen.getByRole("button", { name: "Requesting…" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish(true));
});

it("explains why a venue cannot be requested yet, and flashes it when the button is pressed", async () => {
  setUp(makeEvent({ backendId: 1, status: "submitted" }));
  await screen.findByText("Hall 1");
  expect(screen.getByText("A venue can only be requested for an approved event.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Request booking" }));
  expect(app.flash).toHaveBeenCalledWith("A venue can only be requested for an approved event.", "warn");
  expect(app.requestBooking).not.toHaveBeenCalled();
});

it.each([
  ["pending", "Requested", "Awaiting Venue Staff"],
  ["approved", "Booked", "Confirmed booking"],
] as const)("a venue already %s for this event shows '%s' and cannot be requested again", async (status, label, note) => {
  setUp(makeEvent({ backendId: 1, status: "approved", bookings: [booking({ venue_id: 1, venue_name: "Hall 1", status })] }));
  await screen.findByText(note);
  const button = screen.getByRole("button", { name: label });
  fireEvent.click(button);
  expect(app.requestBooking).not.toHaveBeenCalled();
  expect(card("Hall 1").style.border).toContain("var(--blue)");
});

it("labels the new-booking form by what it is for", async () => {
  const none = setUp();
  expect(screen.getByText("New booking", { selector: ".section-heading" })).toBeTruthy();
  none.unmount();
  setUp(makeEvent({ backendId: 1, status: "approved", bookings: [booking()] }));
  expect(screen.getByText("Book another venue")).toBeTruthy();
});

// ---------------------------------------------------------------- problems and overrides

it("warns that the booked venue needs alternative arrangements", () => {
  problems.value = { "EVT-1": [{ text: "Hall 1 is closed on that date." }] };
  const event = makeEvent({ backendId: 1, status: "approved", venue: "1" });
  setUp(event);
  expect(screen.getByText("Alternative arrangements needed for Hall 1.")).toBeTruthy();
  expect(screen.getByText("Hall 1 is closed on that date.")).toBeTruthy();
});

it("names the booked venue generically when it is not in the catalogue", () => {
  problems.value = { "EVT-1": [{ text: "Closed." }] };
  setUp(makeEvent({ backendId: 1, status: "approved", venue: "gone" }));
  expect(screen.getByText("Alternative arrangements needed for the booked venue.")).toBeTruthy();
});

it("lists the overrides recorded against the event", () => {
  setUp(makeEvent({ backendId: 1, status: "approved", venueOverrides: [
    { verdict: "partially_suitable", acknowledged_by: "Priya Tan", acknowledged_at: "2027-01-02T10:00:00Z", unmet: [{ label: "Capacity", severity: "warn", reason: "Too small." }, { label: "Layout", severity: "warn", reason: "No banquet." }] },
  ] }));
  expect(screen.getByText("Overrides recorded against this event")).toBeTruthy();
  expect(screen.getByText(/Priya Tan went ahead with a venue that was partially suitable/).textContent).toContain("Too small. No banquet.");
});

// ---------------------------------------------------------------- flagged bookings and replacing them

const flagged = (over: Partial<VenueBookingRecord> = {}) => booking({ id: 20, status: "approved", attendance: 90, layout: "banquet", purpose: "Main programme", flag: { message: "Venue closed that day." } as never, ...over });

it("offers to find a replacement for a flagged booking and fills the form from it", async () => {
  setUp(makeEvent({ backendId: 1, status: "approved", bookings: [flagged()] }));
  await screen.findByText("Hall 1");
  const section = within(screen.getByLabelText("Bookings needing a replacement venue"));
  expect(section.getByText("Venue closed that day.")).toBeTruthy();
  fireEvent.click(section.getByRole("button", { name: "Find a replacement venue" }));

  expect(screen.getByText("Replacement for the booking at Hall Nine")).toBeTruthy();
  expect(screen.getByText(/Same timing as the original booking/)).toBeTruthy();
  expect((newBooking().getByLabelText("Attendance") as HTMLInputElement).value).toBe("90");
  expect((newBooking().getByLabelText("Layout") as HTMLSelectElement).value).toBe("banquet");
  expect((newBooking().getByLabelText("Purpose") as HTMLInputElement).value).toBe("Main programme");
  expect(section.getByText("Choose a replacement venue below.")).toBeTruthy();

  await screen.findByText("Hall 1");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Request booking" })); });
  expect(app.requestBooking).toHaveBeenCalledWith(expect.any(String), "1", false, { attendance: 90, layout: "banquet", purpose: "Main programme", replaces: 20 });
});

it("lets the coordinator stop replacing and go back to the event's needs", async () => {
  setUp(makeEvent({ backendId: 1, status: "approved", bookings: [flagged({ purpose: null })] }));
  fireEvent.click(screen.getByRole("button", { name: "Find a replacement venue" }));
  expect((newBooking().getByLabelText("Purpose") as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Stop replacing" }));
  expect(screen.queryByText(/^Replacement for the booking at/)).toBeNull();
  expect((newBooking().getByLabelText("Attendance") as HTMLInputElement).value).toBe("120");
  await screen.findByText("Hall 1");
});

it("goes back to a blank attendance when replacing stops on an event with no expected attendance", () => {
  setUp(makeEvent({ backendId: 1, status: "approved", pax: 0, bookings: [flagged()] }));
  fireEvent.click(screen.getByRole("button", { name: "Find a replacement venue" }));
  fireEvent.click(screen.getByRole("button", { name: "Stop replacing" }));
  expect((newBooking().getByLabelText("Attendance") as HTMLInputElement).value).toBe("");
});

it("copes with the bookings disappearing while a replacement is being chosen", () => {
  const event = makeEvent({ backendId: 1, status: "approved", bookings: [flagged()] });
  const { rerender } = setUp(event);
  fireEvent.click(screen.getByRole("button", { name: "Find a replacement venue" }));
  rerender(<VenueTab event={{ ...event, bookings: undefined }} />);
  expect(screen.queryByText(/^Replacement for the booking at/)).toBeNull();
  expect(screen.getByText("New booking", { selector: ".section-heading" })).toBeTruthy();
});

it("closes an open override warning when replacing starts", async () => {
  answer(suit(1, "unsuitable", [check({ met: false, reason: "Too small." })]));
  setUp(makeEvent({ backendId: 1, status: "approved", bookings: [flagged()] }));
  await screen.findByText("Hall 1");
  fireEvent.click(screen.getByRole("button", { name: "Request anyway…" }));
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Find a replacement venue" }));
  expect(screen.queryByText(/is unsuitable for this event/)).toBeNull();
});

it.each([
  ["approved", "approved"],
  ["pending", "waiting for Venue Staff"],
] as const)("says when a %s replacement has already been requested", (status, text) => {
  setUp(makeEvent({ backendId: 1, status: "approved", bookings: [flagged(), booking({ id: 21, venue_id: 8, venue_name: "Hall Eight", status, replaces_booking_id: 20 })] }));
  expect(screen.getByText(`Replacement requested at Hall Eight (${text}).`)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Find a replacement venue" })).toBeNull();
});

// ---------------------------------------------------------------- the event's bookings

it("shows no bookings card for an event with no bookings", () => {
  setUp(makeEvent({ backendId: 1, status: "approved", bookings: [] }));
  expect(screen.queryByLabelText("Venue bookings for this event")).toBeNull();
});

it("counts the active bookings and cancels them all after a confirmation", async () => {
  setUp(makeEvent({ backendId: 1, status: "approved", bookings: [booking({ id: 1 }), booking({ id: 2, venue_name: "Hall Two" }), booking({ id: 3, status: "cancelled" })] }));
  const list = within(screen.getByLabelText("Venue bookings for this event"));
  expect(list.getByText("2 active")).toBeTruthy();
  fireEvent.click(list.getByRole("button", { name: "Cancel all bookings" }));
  expect(list.getByText("Cancel all 2 bookings?")).toBeTruthy();
  fireEvent.click(list.getByRole("button", { name: "No" }));
  expect(list.queryByText("Cancel all 2 bookings?")).toBeNull();
  fireEvent.click(list.getByRole("button", { name: "Cancel all bookings" }));
  await act(async () => { fireEvent.click(list.getByRole("button", { name: "Yes, cancel all" })); });
  expect(app.cancelAllBookings).toHaveBeenCalledWith("EVT-1");
  expect(list.queryByText(/^Cancel all 2/)).toBeNull();
});

it("offers no 'cancel all' for a single active booking", () => {
  setUp(makeEvent({ backendId: 1, status: "approved", bookings: [booking()] }));
  expect(screen.queryByRole("button", { name: "Cancel all bookings" })).toBeNull();
});

// ---------------------------------------------------------------- one booking

const row = (name = "Hall Nine") => within(screen.getByLabelText(`Booking at ${name}`));
const withBooking = (b: VenueBookingRecord, extra: Partial<VenueBookingRecord>[] = []) => setUp(makeEvent({ backendId: 1, status: "approved", bookings: [b, ...extra.map((e, i) => booking({ id: 100 + i, ...e }))] }));

it.each([
  ["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["cancelled", "Cancelled"], ["expired", "Expired"],
] as const)("shows a %s booking as '%s' with its attendance and layout", (status, label) => {
  withBooking(booking({ status, purpose: "Overflow", attendance: 70, layout: "standing" }));
  expect(row().getByText(label)).toBeTruthy();
  expect(row().getByText("Overflow")).toBeTruthy();
  expect(row().getByText("70 people · Standing layout")).toBeTruthy();
});

it("only a held booking can be changed or cancelled", () => {
  withBooking(booking({ status: "cancelled" }));
  expect(row().queryByRole("button", { name: "Change" })).toBeNull();
});

it("marks a held booking that needs a replacement", () => {
  withBooking(flagged());
  expect(row().getByText("Needs a replacement")).toBeTruthy();
});

it("shows the hold expiry, with a warning colour once the server says it is expiring", () => {
  const first = withBooking(booking({ hold_expires_at: "2027-01-02T10:00:00Z", hold_notice: "expiring_soon" }));
  expect(screen.getByText(/^Held until 02 Jan 2027, 18:00/).style.color).toBe("var(--warn-fg)");
  first.unmount();
  withBooking(booking({ hold_expires_at: "2027-01-02T10:00:00Z", hold_notice: null }));
  expect(screen.getByText(/^Held until/).style.color).toBe("var(--text-muted)");
});

it("says an expired hold released the venue", () => {
  withBooking(booking({ status: "expired", hold_expires_at: "2027-01-02T10:00:00Z" }));
  expect(screen.getByText(/Hold expired 02 Jan 2027, 18:00 — the venue has been released/)).toBeTruthy();
});

it("shows what a replacement replaces, and what replaced a cancelled booking", () => {
  withBooking(booking({ id: 30, status: "cancelled", venue_name: "Hall Old" }), [
    { id: 31, status: "approved", venue_name: "Hall New", replaces_booking_id: 30 },
  ]);
  expect(screen.getByText("Replaced by the booking at Hall New. The booking is kept for reference.")).toBeTruthy();
  expect(screen.getByText("Replacement for the booking at Hall Old (cancelled), kept for reference.")).toBeTruthy();
});

it("shows a cancelled booking that nothing replaced without a 'replaced by' note", () => {
  withBooking(booking({ status: "cancelled" }));
  expect(screen.queryByText(/^Replaced by/)).toBeNull();
});

it("shows the reassessment alert on a held booking", () => {
  withBooking(booking({ reassessment: { message: "Setup time now overlaps another booking." } as never }));
  expect(screen.getByRole("alert").textContent).toContain("Requires Reassessment. Setup time now overlaps another booking.");
});

it("shows why a booking was rejected", () => {
  withBooking(booking({ status: "rejected", decision_reason: "Room under repair" }));
  expect(screen.getByText("Reason: Room under repair")).toBeTruthy();
});

it("cancels one booking only after a confirmation, and 'Keep' backs out", async () => {
  withBooking(booking());
  fireEvent.click(row().getByRole("button", { name: "Cancel booking" }));
  fireEvent.click(row().getByRole("button", { name: "Keep" }));
  expect(row().getByRole("button", { name: "Cancel booking" })).toBeTruthy();
  fireEvent.click(row().getByRole("button", { name: "Cancel booking" }));
  await act(async () => { fireEvent.click(row().getByRole("button", { name: "Confirm cancel" })); });
  expect(app.cancelBooking).toHaveBeenCalledWith("EVT-1", 11);
  expect(row().getByRole("button", { name: "Cancel booking" })).toBeTruthy();
});

it("changes a booking's purpose, attendance and layout and closes the form when it is saved", async () => {
  withBooking(booking({ status: "pending", purpose: null, attendance: 120, layout: "theatre" }));
  fireEvent.click(row().getByRole("button", { name: "Change" }));
  expect(row().queryByText(/sends it back to Venue Staff/)).toBeNull(); // only an approved booking goes back for approval
  fireEvent.change(row().getByLabelText("Purpose"), { target: { value: "Overflow" } });
  fireEvent.change(row().getByLabelText("Attendance"), { target: { value: "60" } });
  fireEvent.change(row().getByLabelText("Layout"), { target: { value: "standing" } });
  await act(async () => { fireEvent.click(row().getByRole("button", { name: "Save change" })); });
  expect(app.changeBooking).toHaveBeenCalledWith("EVT-1", 11, { attendance: 60, layout: "standing", purpose: "Overflow" }, false);
  expect(row().queryByRole("button", { name: "Save change" })).toBeNull();
});

it("sends no attendance when the field is emptied", async () => {
  withBooking(booking());
  fireEvent.click(row().getByRole("button", { name: "Change" }));
  fireEvent.change(row().getByLabelText("Attendance"), { target: { value: "" } });
  await act(async () => { fireEvent.click(row().getByRole("button", { name: "Save change" })); });
  expect((app.changeBooking as ReturnType<typeof vi.fn>).mock.calls[0][2].attendance).toBeUndefined();
});

it("warns that an approved booking goes back to Venue Staff", () => {
  withBooking(booking({ status: "approved" }));
  fireEvent.click(row().getByRole("button", { name: "Change" }));
  expect(row().getByText(/Changing an approved booking sends it back to Venue Staff for approval/)).toBeTruthy();
});

it("shows the server's warning and saves again once it is acknowledged", async () => {
  withBooking(booking());
  app.changeBooking = vi.fn().mockResolvedValueOnce({ ok: false, warning: "The venue is too small." }).mockResolvedValueOnce({ ok: true });
  fireEvent.click(row().getByRole("button", { name: "Change" }));
  await act(async () => { fireEvent.click(row().getByRole("button", { name: "Save change" })); });
  expect(row().getByRole("alert").textContent).toContain("The venue is too small.");
  await act(async () => { fireEvent.click(row().getByRole("button", { name: "Acknowledge and save" })); });
  expect(app.changeBooking).toHaveBeenLastCalledWith("EVT-1", 11, expect.any(Object), true);
  expect(row().queryByRole("alert")).toBeNull();
});

it("keeps the form open, without a warning, when the change fails for another reason", async () => {
  withBooking(booking());
  app.changeBooking = vi.fn().mockResolvedValue({ ok: false });
  fireEvent.click(row().getByRole("button", { name: "Change" }));
  await act(async () => { fireEvent.click(row().getByRole("button", { name: "Save change" })); });
  expect(row().getByRole("button", { name: "Save change" })).toBeTruthy();
  expect(row().queryByRole("alert")).toBeNull();
});

it("discards the edits and any warning", async () => {
  withBooking(booking());
  app.changeBooking = vi.fn().mockResolvedValue({ ok: false, warning: "Too small." });
  fireEvent.click(row().getByRole("button", { name: "Change" }));
  await act(async () => { fireEvent.click(row().getByRole("button", { name: "Save change" })); });
  fireEvent.click(row().getByRole("button", { name: "Discard" }));
  expect(row().getByRole("button", { name: "Change" })).toBeTruthy();
  expect(row().queryByRole("alert")).toBeNull();
});
