// @vitest-environment jsdom
// The review queue's event workspace: header, the next action for the event's status, and the tabs.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { EventWorkspace } from "../../../components/queue/EventWorkspace";
import type { EventRecord } from "../../../lib/types";
import { fakeApp } from "../../helpers/fake-app";
import { makeBooking, makeEvent } from "../../pages/fixtures";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));
vi.mock("../../../components/queue/tabs/RequestTab", () => ({ RequestTab: () => <div>request tab</div> }));
vi.mock("../../../components/queue/tabs/VenueTab", () => ({ VenueTab: () => <div>venue tab</div> }));
vi.mock("../../../components/queue/tabs/EquipmentTab", () => ({ EquipmentTab: () => <div>equipment tab</div> }));
vi.mock("../../../components/queue/tabs/RegistrationTab", () => ({ RegistrationTab: () => <div>registration tab</div> }));
vi.mock("../../../components/queue/tabs/ActivityTab", () => ({ ActivityTab: () => <div>activity tab</div> }));

function setUp(event: EventRecord, over: Parameters<typeof fakeApp>[0] = {}) {
  app = fakeApp({ state: { role: "coordinator", ...(over.state ?? {}) }, ...over });
  return render(<EventWorkspace event={event} />);
}
const buttons = () => screen.queryAllByRole("button").map((b) => b.textContent).filter((t) => !["Request", "Venue", "Equipment", "Registration", "Activity"].includes(t ?? ""));
const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => { app = fakeApp(); });

it("shows the event's name, status, ids, organiser, date, times and attendance", () => {
  setUp(makeEvent({ name: "Design Keynote", id: "EVT-4", pax: 120 }));
  expect(screen.getByText("Design Keynote")).toBeTruthy();
  expect(screen.getByText("EVT-4 · Maya Rahman · 2027-01-04, 10:00–12:00 · 120 expected")).toBeTruthy();
});

it("says attendance is not set, and shows when the details were last updated only if known", () => {
  const unset = setUp(makeEvent({ pax: 0, updatedAt: undefined }));
  expect(screen.getByText(/attendance not set/)).toBeTruthy();
  expect(screen.queryByText(/^Last updated/)).toBeNull();
  unset.unmount();
  setUp(makeEvent({ updatedAt: "2027-01-01T04:30:00Z" }));
  expect(screen.getByText(/^Last updated 01 Jan 2027/)).toBeTruthy();
});

// ---------------------------------------------------------------- tabs

it.each([
  ["request", "request tab"], ["venue", "venue tab"], ["equipment", "equipment tab"],
  ["registration", "registration tab"], ["activity", "activity tab"],
] as const)("shows only the %s tab's content when it is selected", (tab, text) => {
  setUp(makeEvent(), { state: { role: "coordinator", tab } });
  expect(screen.getByText(text)).toBeTruthy();
  expect(screen.getAllByText(/ tab$/)).toHaveLength(1);
});

it("marks the selected tab and switches tabs when one is pressed", () => {
  setUp(makeEvent(), { state: { role: "coordinator", tab: "venue" } });
  expect(screen.getByRole("button", { name: "Venue" }).className).toMatch(/tabActive/);
  expect(screen.getByRole("button", { name: "Activity" }).className).not.toMatch(/tabActive/);
  press("Activity");
  expect(app.setTab).toHaveBeenCalledWith("activity");
});

// ---------------------------------------------------------------- actions by status

it("starts a review of a submitted request", () => {
  setUp(makeEvent({ id: "EVT-4", status: "submitted" }));
  expect(buttons()).toEqual(["Start review"]);
  press("Start review");
  expect(app.startReview).toHaveBeenCalledWith("EVT-4");
});

it("offers the four review decisions while under review", () => {
  setUp(makeEvent({ id: "EVT-4", status: "under_review" }));
  expect(buttons()).toEqual(["Request clarification", "Request amendment", "Reject", "Approve"]);
  for (const [button, modal] of [["Request clarification", "clarify"], ["Request amendment", "amend"], ["Reject", "reject"], ["Approve", "approve"]]) {
    press(button);
    expect(app.openModal).toHaveBeenLastCalledWith(modal, "EVT-4");
  }
});

it("tells the coordinator to wait while the organiser has not replied", () => {
  setUp(makeEvent({ status: "pending_clarification", organiser: "Maya Rahman", clarification: { kind: "clarification", message: "?", requestedBy: "Priya Tan" } as never }));
  press("Awaiting organiser reply");
  expect(app.flash).toHaveBeenCalledWith("Waiting for Maya Rahman to respond.", "warn");
});

it("does not offer to resume a review whose reply cannot be loaded because the event was never saved", () => {
  setUp(makeEvent({ status: "pending_clarification", backendId: undefined, clarification: { response: { message: "yes" } } as never }));
  expect(buttons()).toEqual(["Awaiting organiser reply"]);
});

it("resumes the review once the organiser has replied, and ignores a second press while resuming", async () => {
  let finish!: () => void;
  setUp(makeEvent({ status: "pending_clarification", backendId: 7, clarification: { response: { message: "yes" } } as never }),
    { resumeReview: vi.fn(() => new Promise<void>((a) => { finish = a; })) });
  const button = screen.getByRole("button", { name: "Resume review" });
  act(() => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(screen.getByRole("button", { name: "Resuming…" })).toBeTruthy();
  expect(app.resumeReview).toHaveBeenCalledTimes(1);
  expect(app.resumeReview).toHaveBeenCalledWith(7);
  await act(async () => finish());
  expect(screen.getByRole("button", { name: "Resume review" })).toBeTruthy();
});

it.each(["rejected", "cancelled"] as const)("offers nothing for a %s event", (status) => {
  setUp(makeEvent({ status }));
  expect(buttons()).toEqual([]);
});

it("shows that a safety check is under way", () => {
  setUp(makeEvent({ status: "pending_safety_review" }));
  press("Awaiting safety check");
  expect(app.flash).toHaveBeenCalledWith("A Safety Officer is reviewing this event's arrangements.", "warn");
});

it.each(["safety_changes_requested", "safety_rejected"] as const)("lets the coordinator request the safety check again after %s", (status) => {
  setUp(makeEvent({ status, backendId: 7 }));
  press("Request safety check again");
  expect(app.requestSafetyCheck).toHaveBeenCalledWith(7);
});

it("offers nothing after a safety setback for an event that was never saved", () => {
  setUp(makeEvent({ status: "safety_rejected", backendId: undefined }));
  expect(buttons()).toEqual([]);
});

it("confirms an event once the safety check is approved", () => {
  setUp(makeEvent({ id: "EVT-4", status: "safety_approved" }));
  press("Confirm event");
  expect(app.confirmEvent).toHaveBeenCalledWith("EVT-4");
});

it("shows that Venue Staff have the booking request", () => {
  setUp(makeEvent({ status: "approved", bookingState: "pending", venue: "V1" }));
  press("Awaiting venue decision");
  expect(app.flash).toHaveBeenCalledWith("Venue Staff have this booking request.", "warn");
});

it("sends the coordinator to the Venue tab when no venue is booked yet", () => {
  setUp(makeEvent({ status: "approved", venue: null, bookingState: null }));
  press("Find a venue");
  expect(app.setTab).toHaveBeenCalledWith("venue");
});

it("sends the coordinator to the Equipment tab while equipment is pending", () => {
  setUp(makeEvent({ status: "approved", venue: "V1", bookingState: "approved", equipState: "requested" }));
  press("Equipment pending with Technical Support");
  expect(app.setTab).toHaveBeenCalledWith("equipment");
});

it("asks for the safety check once the venue is booked and equipment settled", () => {
  setUp(makeEvent({ status: "approved", venue: "V1", bookingState: "approved", backendId: 7 }));
  press("Request safety check");
  expect(app.requestSafetyCheck).toHaveBeenCalledWith(7);
});

it("keeps the one-step confirmation for a sample event that was never saved", () => {
  setUp(makeEvent({ id: "EVT-4", status: "approved", venue: "V1", bookingState: "approved", backendId: undefined }));
  press("Confirm event");
  expect(app.confirmEvent).toHaveBeenCalledWith("EVT-4");
});

it("offers nothing when the venue is booked but the booking is not approved or pending and nothing else is due", () => {
  setUp(makeEvent({ status: "approved", venue: "V1", bookingState: "rejected", equipState: null }));
  expect(buttons()).toEqual([]);
});

it("offers nothing for an event in a later status with arrangements in place", () => {
  setUp(makeEvent({ status: "confirmed", venue: "V1", bookingState: "approved", equipState: "reserved" }));
  expect(buttons()).toEqual([]);
});

// ---------------------------------------------------------------- flagged bookings

const flaggedEvent = (status: EventRecord["status"]) => makeEvent({ status, bookings: [makeBooking({ status: "approved", flag: { message: "Closed." } as never })] });

it("puts 'Find a replacement venue' first when a booking needs one", () => {
  setUp(flaggedEvent("approved"));
  expect(buttons()[0]).toBe("Find a replacement venue");
  press("Find a replacement venue");
  expect(app.setTab).toHaveBeenCalledWith("venue");
});

it.each(["rejected", "cancelled"] as const)("does not offer a replacement for a %s event", (status) => {
  setUp(flaggedEvent(status));
  expect(buttons()).toEqual([]);
});
