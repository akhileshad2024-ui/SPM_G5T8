// @vitest-environment jsdom
// The coordinator's Request tab: proposal, review notes, outcomes, confirmation checklist and readiness.
import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { RequestTab } from "../../../components/queue/tabs/RequestTab";
import type { ConfirmationStatus } from "../../../lib/events/confirmation";
import { fakeApp } from "../../helpers/fake-app";
import { makeBooking, makeEvent } from "../../pages/fixtures";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));
vi.mock("../../../components/queue/ReassessmentPanel", () => ({ ReassessmentPanel: () => <div>reassessment panel</div> }));
vi.mock("../../../components/queue/EventDetailsEditor", () => ({ EventDetailsEditor: () => <div>details editor</div> }));
vi.mock("@/components/my-events/ChangeRequests", () => ({ ChangeRequests: (p: { eventId: number }) => <div>{`change requests ${p.eventId}`}</div> }));
vi.mock("@/components/ui/ClarificationThread", () => ({ ClarificationThread: () => <div>clarification thread</div> }));
vi.mock("@/components/ui/EventDetails", () => ({ EventDetailsToggle: () => <div>details toggle</div> }));

const confirmation = (over: Partial<ConfirmationStatus> = {}): ConfirmationStatus => ({
  ready: false, confirmed: false, outstanding: ["Venue is not approved"], confirmedAt: null, confirmedBy: null, lockedFields: [], ...over,
});

function setUp(event = makeEvent(), overrides: Parameters<typeof fakeApp>[0] = {}) {
  app = fakeApp({ state: { role: "coordinator" }, loadConfirmation: vi.fn().mockResolvedValue(null), ...overrides });
  return render(<RequestTab event={event} />);
}

beforeEach(() => { app = fakeApp(); });

it("shows the purpose, the request details and when it was submitted", () => {
  setUp(makeEvent({ purpose: "A talk on design.", eventType: "talk", submittedAt: "2027-01-01T09:30:00Z" }));
  expect(screen.getByText("A talk on design.")).toBeTruthy();
  expect(screen.getByText("Event type")).toBeTruthy();
  expect(screen.getByText("talk")).toBeTruthy();
  expect(screen.getByText(/^Submitted 01 Jan 2027/)).toBeTruthy();
  expect(screen.getByText("details toggle")).toBeTruthy();
});

it("does not show a submission time that was never recorded", () => {
  setUp(makeEvent({ submittedAt: undefined }));
  expect(screen.queryByText(/^Submitted /)).toBeNull();
});

it("shows the coordinator and who assigned them, or 'Unassigned'", () => {
  const assigned = setUp(makeEvent({ coordinator: "Priya Tan", assignedBy: "Grace Ong", assignedAt: "2027-01-02T10:00:00Z" }));
  expect(screen.getByText("Priya Tan", { selector: "div" })).toBeTruthy();
  expect(screen.getByText(/^Assigned by Grace Ong on 02 Jan 2027/)).toBeTruthy();
  assigned.unmount();

  const undated = setUp(makeEvent({ coordinator: "Priya Tan", assignedBy: "Grace Ong", assignedAt: null }));
  expect(screen.getByText("Assigned by Grace Ong")).toBeTruthy();
  undated.unmount();

  setUp(makeEvent({ coordinator: null }));
  expect(screen.getAllByText("Unassigned").length).toBeGreaterThan(0);
  expect(screen.queryByText(/^Assigned by/)).toBeNull();
});

it("shows an unreadable timestamp as it was sent", () => {
  setUp(makeEvent({ submittedAt: "not a date" }));
  expect(screen.getByText("Submitted not a date")).toBeTruthy();
});

it.each([
  ["approved booking", { bookingState: "approved", venue: "V1" }, "Hall A"],
  ["pending booking", { bookingState: "pending" }, "Pending"],
  ["no booking", { bookingState: null }, "Not booked"],
  ["reserved equipment", { equipState: "reserved" }, "Reserved"],
  ["requested equipment", { equipState: "requested" }, "Requested"],
  ["no equipment", { equipState: null }, "None"],
  ["registration on", { reg: true, regCap: 50, registered: 20 }, "20 / 50"],
  ["registration off", { reg: false }, "Disabled"],
  ["coordinator assigned", { coordinator: "Priya Tan" }, "Assigned"],
  ["no coordinator", { coordinator: null }, "Not yet"],
] as const)("readiness shows %s", (_name, over, text) => {
  setUp(makeEvent(over as never), { venue: vi.fn().mockReturnValue({ name: "Hall A" }) });
  expect(screen.getAllByText(text).length).toBeGreaterThan(0);
});

it("shows an empty venue name when the approved venue is not in the catalogue", () => {
  setUp(makeEvent({ bookingState: "approved", venue: "V9" }), { venue: vi.fn().mockReturnValue(undefined) });
  expect(screen.getByText("Venue")).toBeTruthy();
});

it("lists what is worth clarifying while the request is still being reviewed", () => {
  setUp(makeEvent({ status: "under_review", pax: 200, venueCapacity: 100, equip: [{ id: "E1", qty: 1 }] }), { equipName: () => "Wireless microphone" });
  expect(screen.getByText("Worth clarifying")).toBeTruthy();
  expect(screen.getByText(/higher than the requested venue capacity/)).toBeTruthy();
  expect(screen.getByText("No technical requirements given for Wireless microphone.")).toBeTruthy();
});

it("shows no clarification list when the review has nothing to flag, or once the request is decided", () => {
  const clean = setUp(makeEvent({ status: "under_review" }));
  expect(screen.queryByText("Worth clarifying")).toBeNull();
  clean.unmount();
  setUp(makeEvent({ status: "approved", pax: 200, venueCapacity: 100 }));
  expect(screen.queryByText("Worth clarifying")).toBeNull();
});

it.each([
  ["approved", "Approved", "Looks good"],
  ["rejected", "Rejected", ""],
] as const)("shows a %s decision", (outcome, label, reason) => {
  setUp(makeEvent({ decision: { outcome, by: "Priya Tan", at: "2027-01-03T10:00:00Z", reason } as never }));
  expect(screen.getByText(label, { selector: ".eyebrow" })).toBeTruthy();
  expect(screen.getByText(/^Priya Tan · 03 Jan 2027/)).toBeTruthy();
  if (reason) expect(screen.getByText(reason)).toBeTruthy();
});

it("shows the clarification thread, and says who the coordinator is waiting for", () => {
  const waiting = setUp(makeEvent({ status: "pending_clarification", organiser: "Maya Rahman", clarification: { kind: "clarification", message: "?", requestedBy: "Priya Tan" } as never }));
  expect(screen.getByText("clarification thread")).toBeTruthy();
  expect(screen.getByText("Waiting for Maya Rahman to respond.")).toBeTruthy();
  waiting.unmount();

  const answered = setUp(makeEvent({ status: "pending_clarification", clarification: { kind: "clarification", message: "?", requestedBy: "Priya Tan", response: { message: "yes", respondedBy: "Maya" } } as never }));
  expect(screen.queryByText(/^Waiting for/)).toBeNull();
  answered.unmount();

  setUp(makeEvent({ status: "under_review", clarification: { kind: "clarification", message: "?", requestedBy: "Priya Tan" } as never }));
  expect(screen.queryByText(/^Waiting for/)).toBeNull();
});

it.each([
  ["approved", "Safety approved", "", "approved"],
  ["changes_requested", "Safety changes requested", "Widen the exit", "safety_changes_requested"],
  ["rejected", "Safety rejected", "Unsafe", "safety_rejected"],
] as const)("shows a %s safety outcome", (outcome, label, comment, status) => {
  setUp(makeEvent({ status, backendId: 1, safetyReview: { outcome, comment: comment || null, by: "Hannah Lau", at: "2027-01-04T10:00:00Z" } }));
  expect(screen.getByLabelText("Safety check outcome").textContent).toContain(label);
  expect(screen.getByText(/^Hannah Lau · 04 Jan 2027/)).toBeTruthy();
  if (comment) expect(screen.getByText(comment, { selector: "div" })).toBeTruthy();
  expect(!!screen.queryByText(/This event is not closed/)).toBe(status !== "approved");
});

it("shows the safety outcome without a comment and without the 'not closed' hint on an approved event", () => {
  setUp(makeEvent({ status: "safety_approved", backendId: undefined, safetyReview: { outcome: "approved", comment: null, by: "Hannah Lau", at: "2027-01-04T10:00:00Z" } }));
  expect(screen.queryByText(/This event is not closed/)).toBeNull();
});

it("shows the reassessment panel only for a stored event", () => {
  const stored = setUp(makeEvent({ backendId: 1 }));
  expect(screen.getByText("reassessment panel")).toBeTruthy();
  stored.unmount();
  setUp(makeEvent({ backendId: undefined }));
  expect(screen.queryByText("reassessment panel")).toBeNull();
});

it("shows the existing arrangements to the assigned coordinator of a stored event", () => {
  setUp(makeEvent({
    backendId: 1, coordinator: "Priya Tan", reg: true, regCap: 50, registered: 20, equipState: "requested",
    equip: [{ id: "E1", qty: 2 }], bookings: [makeBooking({ venue_name: "Hall A", status: "approved", attendance: 120 })],
  }), { equipName: () => "Wireless microphone" });
  const section = screen.getByRole("region", { name: "Existing arrangements" });
  expect(section.textContent).toContain("Hall A: approved; 2027-01-04, 10:00–12:00; attendance 120; layout theatre.");
  expect(section.textContent).toContain("Equipment: requested. Wireless microphone × 2");
  expect(section.textContent).toContain("Registration: 20 registered / capacity 50.");
  expect(screen.getByText("change requests 1")).toBeTruthy();
});

it("says so when there are no bookings, no equipment state and registration is disabled", () => {
  setUp(makeEvent({ backendId: 1, coordinator: "Priya Tan", reg: false, equipState: null, equip: [], bookings: [] }));
  const section = screen.getByRole("region", { name: "Existing arrangements" });
  expect(section.textContent).toContain("No venue bookings recorded.");
  expect(section.textContent).toContain("Equipment: None.");
  expect(section.textContent).toContain("Registration: Disabled.");
});

it("says there are no bookings when the event has no booking list at all", () => {
  setUp(makeEvent({ backendId: 1, coordinator: "Priya Tan", bookings: undefined }));
  expect(screen.getByText("No venue bookings recorded.")).toBeTruthy();
});

it.each([
  ["another coordinator's event", { coordinator: "Someone Else" }, "coordinator"],
  ["an event that was never saved", { backendId: undefined }, "coordinator"],
  ["a viewer who is not a coordinator", {}, "lead"],
] as const)("hides the existing arrangements for %s", (_n, over, role) => {
  setUp(makeEvent({ coordinator: "Priya Tan", ...over }), { state: { role } });
  expect(screen.queryByRole("region", { name: "Existing arrangements" })).toBeNull();
});

it("a coordinator who is signed in under a different name does not see arrangements", () => {
  setUp(makeEvent({ coordinator: "Priya Tan" }), { me: { person: "Other Person", label: "x", email: "x" } as never });
  expect(screen.queryByRole("region", { name: "Existing arrangements" })).toBeNull();
});

it("shows the outstanding items before an event can be confirmed", async () => {
  setUp(makeEvent({ status: "approved", backendId: 1 }), { loadConfirmation: vi.fn().mockResolvedValue(confirmation({ outstanding: ["Venue is not approved", "Equipment is not reserved"] })) });
  expect(await screen.findByLabelText("Outstanding before confirming")).toBeTruthy();
  expect(screen.getByText("Equipment is not reserved")).toBeTruthy();
});

it("says the event is ready to confirm", async () => {
  setUp(makeEvent({ status: "safety_approved", backendId: 1, name: "Design Keynote" }), { loadConfirmation: vi.fn().mockResolvedValue(confirmation({ ready: true })) });
  expect(await screen.findByText(/Design Keynote is ready to confirm/)).toBeTruthy();
});

it("shows who confirmed the event, when, and which fields are locked", async () => {
  setUp(makeEvent({ status: "confirmed", backendId: 1 }), {
    loadConfirmation: vi.fn().mockResolvedValue(confirmation({ confirmed: true, confirmedBy: "Priya Tan", confirmedAt: "2027-01-05T09:30:00Z", lockedFields: ["date", "start", "equipment"] })),
  });
  expect(await screen.findByText(/^Confirmed by Priya Tan on 05 Jan 2027/)).toBeTruthy();
  expect(screen.getByText(/Locked: date, start time and equipment request\./)).toBeTruthy();
});

it("shows nothing for the confirmation when it cannot be loaded or the status does not call for it", async () => {
  const failing = setUp(makeEvent({ status: "approved", backendId: 1 }), { loadConfirmation: vi.fn().mockRejectedValue(new Error("offline")) });
  await act(async () => {});
  expect(screen.queryByLabelText("Confirmation")).toBeNull();
  failing.unmount();

  setUp(makeEvent({ status: "submitted", backendId: 1 }));
  expect(app.loadConfirmation).not.toHaveBeenCalled();
});

it("ignores a confirmation that arrives after the tab is closed", async () => {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const first = setUp(makeEvent({ status: "approved", backendId: 1 }), { loadConfirmation: vi.fn(() => new Promise((a) => { resolve = a; })) });
  first.unmount();
  await act(async () => resolve(confirmation()));
  const second = setUp(makeEvent({ status: "approved", backendId: 1 }), { loadConfirmation: vi.fn(() => new Promise((_a, b) => { reject = b; })) });
  second.unmount();
  await act(async () => reject(new Error("late")));
  expect(screen.queryByLabelText("Confirmation")).toBeNull();
});
