// @vitest-environment jsdom
// US33/34: a response for event A must never change what is shown for event B.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ChangeRequests } from "../../../components/my-events/ChangeRequests";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiFetch: api }));

const request = (id: number, eventId: number, status = "pending", decision?: object) => ({
  id, event_id: eventId, requested_by_id: 1, requested_at: "2030-01-01T00:00:00Z",
  proposed_changes: `Proposal ${id}`, status, decision,
});

// Answers the list calls straight away and holds the one call we want to delay.
function serve(lists: Record<number, unknown[]>, held: "decision" | "apply") {
  const hold: { resolve: (v: unknown) => void; reject: (e: unknown) => void } = { resolve: () => {}, reject: () => {} };
  api.mockImplementation((path: string) => {
    const list = /^\/events\/(\d+)\/change-requests$/.exec(path);
    if (list) return Promise.resolve(lists[Number(list[1])]);
    if (path.endsWith(held)) return new Promise((resolve, reject) => { hold.resolve = resolve; hold.reject = reject; });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  return hold;
}

beforeEach(() => { api.mockReset(); });

it("drops a late decision for the old event and keeps the new event's list", async () => {
  const hold = serve({ 1: [request(1, 1)], 2: [request(7, 2)] }, "decision");
  const { rerender } = render(<ChangeRequests eventId={1} canReview />);
  await screen.findByText("Proposal 1");
  fireEvent.click(screen.getByText("Accept change request"));

  rerender(<ChangeRequests eventId={2} canReview />);
  await screen.findByText("Proposal 7");

  await act(async () => hold.resolve(request(1, 1, "accepted")));
  expect(screen.getByText("Proposal 7")).toBeTruthy();
  expect(screen.queryByText("Proposal 1")).toBeNull();
});

it("does not show a late decision error on the new event", async () => {
  const hold = serve({ 1: [request(1, 1)], 2: [request(7, 2)] }, "decision");
  const { rerender } = render(<ChangeRequests eventId={1} canReview />);
  await screen.findByText("Proposal 1");
  fireEvent.click(screen.getByText("Reject change request"));

  rerender(<ChangeRequests eventId={2} canReview />);
  await screen.findByText("Proposal 7");

  await act(async () => hold.reject(new Error("offline")));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Proposal 7")).toBeTruthy();
});

it("unlocks the controls for the new event after the old request finishes", async () => {
  const hold = serve({ 1: [request(1, 1)], 2: [request(7, 2)] }, "decision");
  const { rerender } = render(<ChangeRequests eventId={1} canReview />);
  await screen.findByText("Proposal 1");
  fireEvent.click(screen.getByText("Accept change request"));
  rerender(<ChangeRequests eventId={2} canReview />);
  await screen.findByText("Proposal 7");

  await act(async () => hold.resolve(request(1, 1, "accepted")));
  expect((screen.getByText("Accept change request") as HTMLButtonElement).disabled).toBe(false);
});

it("does not reload the page or show an error when a late apply belongs to the old event", async () => {
  const applied = { reassessment: { effective_changes: { pax: 90 } } };
  const hold = serve({ 1: [request(1, 1, "accepted", applied)], 2: [request(7, 2)] }, "apply");
  const { rerender } = render(<ChangeRequests eventId={1} canReview />);
  fireEvent.click(await screen.findByText("Apply reviewed changes #1"));
  rerender(<ChangeRequests eventId={2} canReview />);
  await screen.findByText("Proposal 7");

  await act(async () => hold.resolve({}));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Proposal 7")).toBeTruthy();
});

it("does not show a late apply error on the new event", async () => {
  const applied = { reassessment: { effective_changes: { pax: 90 } } };
  const hold = serve({ 1: [request(1, 1, "accepted", applied)], 2: [request(7, 2)] }, "apply");
  const { rerender } = render(<ChangeRequests eventId={1} canReview />);
  fireEvent.click(await screen.findByText("Apply reviewed changes #1"));
  rerender(<ChangeRequests eventId={2} canReview />);
  await screen.findByText("Proposal 7");

  await act(async () => hold.reject(new Error("Cannot apply")));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("still replaces only the matching request when the event has not changed", async () => {
  const hold = serve({ 1: [request(1, 1), request(2, 1)] }, "decision");
  render(<ChangeRequests eventId={1} canReview />);
  await screen.findByText("Proposal 1");
  fireEvent.click(screen.getAllByText("Accept change request")[0]);

  await act(async () => hold.resolve(request(1, 1, "accepted", { reason: "Done", by: "Priya" })));
  expect(screen.getByText("Review outcome: Done")).toBeTruthy();
  expect(screen.getByText("Proposal 2")).toBeTruthy();
});
