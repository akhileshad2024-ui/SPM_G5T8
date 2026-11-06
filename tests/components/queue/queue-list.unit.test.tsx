// @vitest-environment jsdom
// The review queue's left-hand list: search box, filter buttons and one row per event.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { QueueList } from "../../../components/queue/QueueList";
import { fakeApp } from "../../helpers/fake-app";
import { makeBooking, makeEvent } from "../../pages/fixtures";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));

beforeEach(() => { app = fakeApp(); });

it("lists each event with its organiser, attendance, date, coordinator and age", () => {
  const events = [makeEvent({ id: "EVT-1", name: "Design Keynote" }), makeEvent({ id: "EVT-2", name: "Career Fair", pax: 0, coordinator: null, submittedAgo: "3 days ago" })];
  render(<QueueList events={events} selectedId="" />);

  expect(screen.getByText("Design Keynote")).toBeTruthy();
  expect(screen.getByText("Maya Rahman · 120 pax · 2027-01-04")).toBeTruthy();
  expect(screen.getByText("Coordinator: Priya Tan")).toBeTruthy();
  expect(screen.getByText("Maya Rahman · attendance not set · 2027-01-04")).toBeTruthy();
  // "Unassigned" is also the name of a filter button, so look inside the row.
  expect(screen.getByText("Career Fair").closest("button")!.textContent).toContain("Unassigned");
  expect(screen.getByText("3 days ago")).toBeTruthy();
});

it("selects an event when its row is clicked, and marks the selected row", () => {
  render(<QueueList events={[makeEvent({ id: "EVT-7", name: "Selected one" })]} selectedId="EVT-7" />);
  const row = screen.getByText("Selected one").closest("button")!;
  expect(row.className).toMatch(/rowActive/);
  fireEvent.click(row);
  expect(app.select).toHaveBeenCalledWith("EVT-7");
});

it("does not mark a row that is not selected", () => {
  render(<QueueList events={[makeEvent({ id: "EVT-1", name: "Other" })]} selectedId="EVT-9" />);
  expect(screen.getByText("Other").closest("button")!.className).not.toMatch(/rowActive/);
});

it("says so when no event matches the filter", () => {
  render(<QueueList events={[]} selectedId="" />);
  expect(screen.getByText("No events match this filter.")).toBeTruthy();
});

it("passes the search text on and shows what is already typed", () => {
  app = fakeApp({ state: { search: "keynote" } });
  render(<QueueList events={[]} selectedId="" />);
  const box = screen.getByPlaceholderText("Search events, organisers or IDs") as HTMLInputElement;
  expect(box.value).toBe("keynote");
  fireEvent.change(box, { target: { value: "fair" } });
  expect(app.setSearch).toHaveBeenCalledWith("fair");
});

it("changes the filter and highlights the current one", () => {
  app = fakeApp({ state: { queueFilter: "mine" } });
  render(<QueueList events={[]} selectedId="" />);
  expect(screen.getByRole("button", { name: "Mine" }).className).toMatch(/filterActive/);
  expect(screen.getByRole("button", { name: "All" }).className).not.toMatch(/filterActive/);
  fireEvent.click(screen.getByRole("button", { name: "Unassigned" }));
  expect(app.setQueueFilter).toHaveBeenCalledWith("unassigned");
});

it("counts the events that need a replacement venue on the 'Needs a venue' filter", () => {
  const flagged = makeEvent({ id: "EVT-1", bookings: [makeBooking({ status: "approved", flag: { reason: "Venue closed" } as never })] });
  const fine = makeEvent({ id: "EVT-2", bookings: [makeBooking({ id: 12, status: "approved" })] });
  app = fakeApp({ state: { events: [flagged, fine] } });
  render(<QueueList events={[flagged, fine]} selectedId="" />);
  expect(screen.getByRole("button", { name: "Needs a venue (1)" })).toBeTruthy();
});

it("shows no count when no event needs a replacement venue", () => {
  const fine = makeEvent({ id: "EVT-2" });
  app = fakeApp({ state: { events: [fine] } });
  render(<QueueList events={[fine]} selectedId="" />);
  expect(screen.getByRole("button", { name: "Needs a venue" })).toBeTruthy();
});
