// @vitest-environment jsdom
// US45/US49-US51: open and resolved reassessment flags, who may resolve them, and the preparation step.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReassessmentPanel } from "../../../components/queue/ReassessmentPanel";
import { fakeApp } from "../../helpers/fake-app";
import { makeEvent } from "../../pages/fixtures";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiFetch: api }));
let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));

const flag = (id: number, over = {}) => ({
  id, targetType: "venue", targetId: 5, source: "event_details", sourceId: 2, reason: "Attendance rose",
  status: "open", resolution: null, resolvedAt: null, ...over,
});
const summary = (over = {}) => ({ flags: [flag(1)], planningStage: null, canPrepare: false, preparedAt: null, preparationIssues: [], ...over });

beforeEach(() => { api.mockReset(); app = fakeApp({ state: { role: "coordinator" } }); });

it("renders nothing while loading, and nothing when there are no flags and no preparation", async () => {
  api.mockResolvedValue(summary({ flags: [] }));
  const { container } = render(<ReassessmentPanel eventId={1} />);
  expect(container.innerHTML).toBe("");
  await waitFor(() => expect(api).toHaveBeenCalledWith("/events/1/reassessments"));
  await act(async () => {});
  expect(container.innerHTML).toBe("");
});

it("shows a flag with its reason and source, and the stage the event was returned to", async () => {
  api.mockResolvedValue(summary({ planningStage: "venue_planning" }));
  render(<ReassessmentPanel eventId={1} />);
  expect(await screen.findByText("venue #5 — open")).toBeTruthy();
  expect(screen.getByText("Attendance rose")).toBeTruthy();
  expect(screen.getByText("event details #2")).toBeTruthy();
  expect(screen.getByText("Returned to venue planning.")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Arrangement reassessments" })).toBeTruthy();
  expect(screen.getByText("Arrangement reassessment")).toBeTruthy();
});

it("uses a custom heading and only shows flags of the requested kind", async () => {
  api.mockResolvedValue(summary({ flags: [flag(1), flag(2, { targetType: "registration", targetId: 8 })] }));
  render(<ReassessmentPanel eventId={1} kind="registration" heading="Registration flags" />);
  expect(await screen.findByText("registration #8 — open")).toBeTruthy();
  expect(screen.queryByText("venue #5 — open")).toBeNull();
  expect(screen.getByRole("region", { name: "registration reassessments" })).toBeTruthy();
  expect(screen.getByText("Registration flags")).toBeTruthy();
});

it("shows the resolution of a resolved flag and no form", async () => {
  api.mockResolvedValue(summary({ flags: [flag(1, { status: "resolved", resolvedAt: "2027-01-02T00:00:00Z", resolution: "Venue enlarged" })] }));
  render(<ReassessmentPanel eventId={1} />);
  expect(await screen.findByText("Resolved: Venue enlarged")).toBeTruthy();
  expect(screen.queryByLabelText("Resolution evidence")).toBeNull();
});

it("lets the coordinator resolve a flag only after writing evidence, then reloads", async () => {
  api.mockResolvedValueOnce(summary()).mockResolvedValueOnce({}).mockResolvedValueOnce(summary({ flags: [flag(1, { resolvedAt: "2027-01-02T00:00:00Z", resolution: "Done" })] }));
  render(<ReassessmentPanel eventId={1} />);
  const button = (await screen.findByText("Resolve reassessment #1")) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Resolution evidence"), { target: { value: "  " } });
  expect(button.disabled).toBe(true); // blank evidence does not count
  fireEvent.change(screen.getByLabelText("Resolution evidence"), { target: { value: "Done" } });
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(await screen.findByText("Resolved: Done")).toBeTruthy();
  expect(api).toHaveBeenNthCalledWith(2, "/events/1/reassessments/1/resolve", { method: "POST", body: JSON.stringify({ note: "Done" }) });
});

it("shows the failure message and lets the user try again", async () => {
  api.mockResolvedValueOnce(summary()).mockRejectedValueOnce(new Error("Cannot resolve")).mockRejectedValueOnce("plain");
  render(<ReassessmentPanel eventId={1} />);
  fireEvent.change(await screen.findByLabelText("Resolution evidence"), { target: { value: "Done" } });
  fireEvent.click(screen.getByText("Resolve reassessment #1"));
  expect((await screen.findByRole("alert")).textContent).toBe("Cannot resolve");
  fireEvent.click(screen.getByText("Resolve reassessment #1"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not save. Refresh to check the current state."));
});

it("ignores a second click while a save is in progress", async () => {
  let release!: (v: unknown) => void;
  api.mockResolvedValueOnce(summary()).mockImplementationOnce(() => new Promise((a) => { release = a; })).mockResolvedValue(summary());
  render(<ReassessmentPanel eventId={1} />);
  fireEvent.change(await screen.findByLabelText("Resolution evidence"), { target: { value: "Done" } });
  const button = screen.getByText("Resolve reassessment #1");
  act(() => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(api).toHaveBeenCalledTimes(2);
  await act(async () => release({}));
});

it("shows a load error even when there are no flags", async () => {
  api.mockRejectedValue(new Error("Could not load"));
  render(<ReassessmentPanel eventId={1} />);
  expect((await screen.findByRole("alert")).textContent).toBe("Could not load");
  expect(screen.getByText("No reassessment flags recorded.")).toBeTruthy();
});

it.each([
  ["equipment", "tech", true],
  ["equipment", "coordinator", false],
  ["venue", "venue", true],
  ["venue", "tech", false],
  ["registration", "venue", false],
  ["registration", "coordinator", true],
] as const)("a %s flag can be resolved by %s: %s", async (targetType, role, canResolve) => {
  app = fakeApp({ state: { role } });
  api.mockResolvedValue(summary({ flags: [flag(1, { targetType })] }));
  render(<ReassessmentPanel eventId={1} />);
  await screen.findByText(new RegExp(`${targetType} #5`));
  expect(!!screen.queryByLabelText("Resolution evidence")).toBe(canResolve);
});

it("reloads when arrangements change anywhere on the page, and stops listening afterwards", async () => {
  api.mockResolvedValue(summary());
  const { unmount } = render(<ReassessmentPanel eventId={1} />);
  await screen.findByText("venue #5 — open");
  act(() => { window.dispatchEvent(new Event("arrangements-changed")); });
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  unmount();
  window.dispatchEvent(new Event("arrangements-changed"));
  expect(api).toHaveBeenCalledTimes(2);
});

it("reloads when the stored event's status or update time changes", async () => {
  const stored = makeEvent({ backendId: 1, status: "approved", updatedAt: "2027-01-01T00:00:00Z" });
  app = fakeApp({ state: { role: "coordinator", events: [stored] } });
  api.mockResolvedValue(summary());
  const { rerender } = render(<ReassessmentPanel eventId={1} />);
  await screen.findByText("venue #5 — open");
  app = fakeApp({ state: { role: "coordinator", events: [{ ...stored, updatedAt: "2027-01-02T00:00:00Z" }] } });
  rerender(<ReassessmentPanel eventId={1} />);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
});

it("ignores a load that finishes after the panel is gone", async () => {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  api.mockReturnValueOnce(new Promise((a) => { resolve = a; })).mockReturnValueOnce(new Promise((_a, b) => { reject = b; }));
  render(<ReassessmentPanel eventId={1} />).unmount();
  render(<ReassessmentPanel eventId={1} />).unmount();
  await act(async () => { resolve(summary()); reject(new Error("late")); });
  expect(screen.queryByRole("alert")).toBeNull();
});

describe("preparation step", () => {
  it("lets the coordinator start preparation when it is allowed, then reloads", async () => {
    api.mockResolvedValueOnce(summary({ flags: [], canPrepare: true })).mockResolvedValueOnce({})
      .mockResolvedValueOnce(summary({ flags: [], preparedAt: "2027-01-03T10:00:00Z" }));
    render(<ReassessmentPanel eventId={1} preparation />);
    fireEvent.click(await screen.findByText("Start preparation"));
    expect(await screen.findByText(/Preparation started/)).toBeTruthy();
    expect(api).toHaveBeenNthCalledWith(2, "/events/1/preparation", { method: "POST", body: undefined });
    expect(screen.getByText("No reassessment flags recorded.")).toBeTruthy();
  });

  it("lists what blocks preparation and keeps the button disabled", async () => {
    api.mockResolvedValue(summary({ flags: [], canPrepare: false, preparationIssues: ["Venue is not approved"] }));
    render(<ReassessmentPanel eventId={1} preparation />);
    expect(await screen.findByText("Venue is not approved")).toBeTruthy();
    expect((screen.getByText("Start preparation") as HTMLButtonElement).disabled).toBe(true);
  });

  it("hides the preparation step from anyone but the coordinator", async () => {
    app = fakeApp({ state: { role: "venue" } });
    api.mockResolvedValue(summary());
    render(<ReassessmentPanel eventId={1} preparation />);
    await screen.findByText("venue #5 — open");
    expect(screen.queryByText("Preparation")).toBeNull();
  });
});
