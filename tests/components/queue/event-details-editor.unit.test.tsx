// @vitest-environment jsdom
// US16: the assigned coordinator edits an event's details; only changed fields are sent.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { EventDetailsEditor } from "../../../components/queue/EventDetailsEditor";
import type { EventRecord } from "../../../lib/types";
import { fakeApp } from "../../helpers/fake-app";
import { makeEvent } from "../../pages/fixtures";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));

const saved = (over: Partial<EventRecord> = {}) => makeEvent({
  status: "under_review", name: "Design Keynote", purpose: "A talk.", eventType: "talk", pax: 120, date: "2027-01-04",
  start: "10:00", end: "12:00", venueLocation: "Main campus", venueCapacity: 150, layout: "theatre",
  facilities: ["Stage"], access: [], equip: [{ id: "E1", qty: 2, technicalRequirements: "HDMI" }], reg: true, regCap: 50, regClose: "2027-01-01",
  ...over,
});

function setUp(event = saved(), overrides: Parameters<typeof fakeApp>[0] = {}, role: "coordinator" | "tech" = "coordinator") {
  app = fakeApp({
    state: { role }, loadEvent: vi.fn().mockResolvedValue(saved()), saveEventDetails: vi.fn().mockResolvedValue(true), ...overrides,
  });
  return render(<EventDetailsEditor event={event} />);
}
async function openEditor() {
  fireEvent.click(screen.getByText("Edit event details"));
  await screen.findByRole("button", { name: "Save changes" });
}
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => { app = fakeApp(); });

it.each([
  ["a user who is not a coordinator", () => setUp(saved(), {}, "tech")],
  ["a coordinator who is not assigned", () => setUp(saved({ coordinator: "Someone Else" }))],
  ["an event in a status that cannot be edited", () => setUp(saved({ status: "rejected" }))],
  ["an event that was never saved", () => setUp(saved({ backendId: undefined }))],
])("shows nothing to %s", (_name, render_) => {
  const { container } = render_();
  expect(container.innerHTML).toBe("");
});

it("loads the latest details when 'Edit event details' is pressed and shows no changes yet", async () => {
  setUp();
  fireEvent.click(screen.getByText("Edit event details"));
  expect((screen.getByText("Loading…") as HTMLButtonElement).disabled).toBe(true);
  await screen.findByRole("button", { name: "Save changes" });
  expect(app.loadEvent).toHaveBeenCalledWith(1);
  expect(field("Event name").value).toBe("Design Keynote");
  expect(field("Expected attendance").value).toBe("120");
  expect(screen.getByRole("status").textContent).toBe("No changes.");
  expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
});

it("shows an error when the details cannot be loaded, and lets the user try again", async () => {
  setUp(saved(), { loadEvent: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(saved()) });
  fireEvent.click(screen.getByText("Edit event details"));
  expect((await screen.findByRole("alert")).textContent).toBe("Could not load event details. Please try again.");
  await openEditor();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("loads once when the button is pressed twice at once", async () => {
  setUp();
  const button = screen.getByText("Edit event details");
  act(() => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await screen.findByRole("button", { name: "Save changes" });
  expect(app.loadEvent).toHaveBeenCalledTimes(1);
});

it("sends only the fields that changed", async () => {
  setUp();
  await openEditor();
  fireEvent.change(screen.getByLabelText("Purpose and description"), { target: { value: "A new purpose." } });
  fireEvent.change(field("Expected attendance"), { target: { value: "90" } });
  fireEvent.change(field("Proposed date"), { target: { value: "2027-02-01" } });
  fireEvent.change(field("Start"), { target: { value: "11:00" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
  expect(app.saveEventDetails).toHaveBeenCalledWith(1, { purpose: "A new purpose.", pax: 90, date: "2027-02-01", start: "11:00" });
});

it("turns a cleared number or date into null, but keeps a cleared name, type and location as empty text", async () => {
  setUp();
  await openEditor();
  fireEvent.change(field("Expected attendance"), { target: { value: "" } });
  fireEvent.change(field("Registration closing date"), { target: { value: "" } });
  fireEvent.change(field("Event name"), { target: { value: "" } });
  fireEvent.change(field("Event type"), { target: { value: "" } });
  fireEvent.change(field("Preferred venue location"), { target: { value: "" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
  expect(app.saveEventDetails).toHaveBeenCalledWith(1, { pax: null, regClose: null, name: "", eventType: "", venueLocation: "" });
});

it("changes the layout, and 'No preference' clears it", async () => {
  setUp();
  await openEditor();
  fireEvent.change(screen.getByLabelText("Layout"), { target: { value: "classroom" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
  expect(app.saveEventDetails).toHaveBeenLastCalledWith(1, { layout: "classroom" });
});

it("clears the layout with 'No preference'", async () => {
  setUp();
  await openEditor();
  fireEvent.change(screen.getByLabelText("Layout"), { target: { value: "" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
  expect(app.saveEventDetails).toHaveBeenCalledWith(1, { layout: null });
});

it("ticks and unticks facilities and accessibility needs", async () => {
  setUp();
  await openEditor();
  fireEvent.click(screen.getByLabelText("Projector"));
  fireEvent.click(screen.getByLabelText("Stage")); // was ticked
  fireEvent.click(screen.getByLabelText("Wheelchair Access"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
  expect(app.saveEventDetails).toHaveBeenCalledWith(1, { facilities: ["Projector"], access: ["Wheelchair Access"] });
});

it("copes with an event that has no facilities, accessibility, equipment or registration saved", async () => {
  setUp(saved(), { loadEvent: vi.fn().mockResolvedValue(saved({ purpose: undefined as never, facilities: undefined as never, access: undefined as never, equip: undefined as never, reg: undefined as never })) });
  await openEditor();
  expect((screen.getByLabelText("Purpose and description") as HTMLTextAreaElement).value).toBe("");
  expect((screen.getByLabelText("Projector", { selector: "input[type=checkbox]" }) as HTMLInputElement).checked).toBe(false);
  expect(field("Projector quantity").value).toBe("0");
  fireEvent.click(screen.getByLabelText("Projector", { selector: "input[type=checkbox]" })); // adds to an unset list
  fireEvent.change(field("Projector quantity"), { target: { value: "3" } }); // adds to an unset equipment list
  fireEvent.click(screen.getByLabelText("Enable attendee registration"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
  expect(app.saveEventDetails).toHaveBeenCalledWith(1, { facilities: ["Projector"], equip: [{ id: "E2", qty: 3, technicalRequirements: "" }], reg: true });
});

it("adds, changes and removes equipment lines, with technical requirements", async () => {
  setUp();
  await openEditor();
  expect(field("Wireless microphone quantity").value).toBe("2");
  expect(field("Wireless microphone technical requirements").value).toBe("HDMI");
  fireEvent.change(field("Projector quantity"), { target: { value: "3" } }); // a new line
  expect(field("Projector technical requirements").value).toBe("");
  // Editing one line's requirements leaves the other line alone.
  fireEvent.change(field("Wireless microphone technical requirements"), { target: { value: "XLR" } });
  fireEvent.change(field("PA system quantity"), { target: { value: "1" } });
  fireEvent.change(field("PA system quantity"), { target: { value: "0" } }); // removed again
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
  expect(app.saveEventDetails).toHaveBeenCalledWith(1, { equip: [
    { id: "E1", qty: 2, technicalRequirements: "XLR" },
    { id: "E2", qty: 3, technicalRequirements: "" },
  ] });
});

it("keeps a line with no saved technical requirements blank", async () => {
  setUp(saved(), { loadEvent: vi.fn().mockResolvedValue(saved({ equip: [{ id: "E1", qty: 1 }] as never })) });
  await openEditor();
  expect(field("Wireless microphone technical requirements").value).toBe("");
  fireEvent.change(field("Wireless microphone quantity"), { target: { value: "4" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
  expect(app.saveEventDetails).toHaveBeenCalledWith(1, { equip: [{ id: "E1", qty: 4, technicalRequirements: "" }] });
});

it.each([
  ["a new name on an event with nothing arranged", {}, { name: "Renamed" }, "Ordinary edit: no existing arrangements are recorded."],
  ["a new attendance on an event with nothing arranged", {}, { pax: 10 }, /May affect existing arrangements/],
  ["a new name on an event with a venue", { venue: "Hall A" }, { name: "Renamed" }, /May affect existing arrangements/],
  ["a new name on an event with a booking request", { bookingState: "pending" }, { name: "Renamed" }, /May affect existing arrangements/],
  ["a new name on an event with equipment requested", { equipState: "requested" }, { name: "Renamed" }, /May affect existing arrangements/],
  ["a new name on an event with registrations", { registered: 3 }, { name: "Renamed" }, /May affect existing arrangements/],
] as const)("explains the impact of %s", async (_n, eventOver, change, message) => {
  setUp(saved(eventOver as Partial<EventRecord>));
  await openEditor();
  if ("name" in change) fireEvent.change(field("Event name"), { target: { value: change.name } });
  if ("pax" in change) fireEvent.change(field("Expected attendance"), { target: { value: String(change.pax) } });
  expect(screen.getByRole("status").textContent).toMatch(message as RegExp);
});

it("does not save when the form is submitted with nothing changed", async () => {
  setUp();
  await openEditor();
  fireEvent.submit(screen.getByRole("button", { name: "Save changes" }).closest("form")!);
  expect(app.saveEventDetails).not.toHaveBeenCalled();
});

it("closes the form after a saved change and keeps it open when the save fails", async () => {
  setUp(saved(), { saveEventDetails: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) });
  await openEditor();
  fireEvent.change(field("Event name"), { target: { value: "Renamed" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
  expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy(); // still open
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
  expect(screen.getByText("Edit event details", { selector: "button" })).toBeTruthy(); // closed
});

it("shows 'Saving…' and ignores a second submit while saving", async () => {
  let finish!: (v: boolean) => void;
  setUp(saved(), { saveEventDetails: vi.fn(() => new Promise<boolean>((a) => { finish = a; })) });
  await openEditor();
  fireEvent.change(field("Event name"), { target: { value: "Renamed" } });
  const form = screen.getByRole("button", { name: "Save changes" }).closest("form")!;
  act(() => { fireEvent.submit(form); fireEvent.submit(form); });
  expect(screen.getByRole("button", { name: "Saving…" })).toBeTruthy();
  expect(app.saveEventDetails).toHaveBeenCalledTimes(1);
  await act(async () => finish(true));
});

it("discards the edits when Cancel is pressed", async () => {
  setUp();
  await openEditor();
  fireEvent.change(field("Event name"), { target: { value: "Renamed" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Edit event details", { selector: "button" })).toBeTruthy();
});
