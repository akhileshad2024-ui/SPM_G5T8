// @vitest-environment jsdom
// US16 AC2: the persisted list of important changes to an event's details.
import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { EventDetailHistory } from "../../../components/queue/EventDetailHistory";
import { makeEvent } from "../../pages/fixtures";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiFetch: api }));

const change = (id: number, changes: Record<string, unknown>, affectsArrangements = false) => ({
  id, changedBy: "Priya Tan", changedAt: "2027-01-01T04:30:00Z", changes, affectsArrangements,
});

beforeEach(() => { api.mockReset(); });

it("shows nothing for an event that was never saved", () => {
  const { container } = render(<EventDetailHistory event={makeEvent({ backendId: undefined })} />);
  expect(container.innerHTML).toBe("");
  expect(api).not.toHaveBeenCalled();
});

it("shows a loading message, then the empty message", async () => {
  api.mockResolvedValue([]);
  render(<EventDetailHistory event={makeEvent()} />);
  expect(screen.getByText("Loading changes…")).toBeTruthy();
  expect(await screen.findByText("No important detail changes recorded.")).toBeTruthy();
  expect(api).toHaveBeenCalledWith("/events/1/detail-changes");
});

it("lists who changed what, with readable labels, plain strings and JSON values", async () => {
  api.mockResolvedValue([
    change(1, { name: "Keynote", facilities: ["PA system", "Projector"], unknownField: "x" }, true),
    change(2, { pax: 90 }),
  ]);
  render(<EventDetailHistory event={makeEvent()} />);
  expect(await screen.findByText("Event name: Keynote")).toBeTruthy();
  expect(screen.getByText('Facilities: ["PA system","Projector"]')).toBeTruthy();
  expect(screen.getByText("unknownField: x")).toBeTruthy(); // no label known: the key is shown
  expect(screen.getByText("Expected attendance: 90")).toBeTruthy();
  expect(screen.getAllByText(/Priya Tan/)).toHaveLength(2);
  expect(screen.getAllByText(/SGT/)[0].textContent).toContain("12:30"); // 04:30 UTC is 12:30 in Singapore
  expect(screen.getAllByText("May affect existing arrangements.")).toHaveLength(1); // only the first change
});

it("shows an error when the changes cannot be loaded", async () => {
  api.mockRejectedValue(new Error("offline"));
  render(<EventDetailHistory event={makeEvent()} />);
  expect((await screen.findByRole("alert")).textContent).toBe("Could not load event detail changes.");
});

it("ignores a response that arrives after the component is gone", async () => {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  api.mockReturnValueOnce(new Promise((a) => { resolve = a; })).mockReturnValueOnce(new Promise((_a, b) => { reject = b; }));
  const first = render(<EventDetailHistory event={makeEvent()} />);
  first.unmount();
  await act(async () => resolve([change(1, { name: "late" })]));
  const second = render(<EventDetailHistory event={makeEvent()} />);
  second.unmount();
  await act(async () => reject(new Error("late")));
  expect(screen.queryByText("Event name: late")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("reloads when the event's last-updated time changes", async () => {
  api.mockResolvedValue([]);
  const { rerender } = render(<EventDetailHistory event={makeEvent({ updatedAt: "2027-01-01T00:00:00Z" })} />);
  await screen.findByText("No important detail changes recorded.");
  rerender(<EventDetailHistory event={makeEvent({ updatedAt: "2027-01-02T00:00:00Z" })} />);
  await screen.findByText("No important detail changes recorded.");
  expect(api).toHaveBeenCalledTimes(2);
});
