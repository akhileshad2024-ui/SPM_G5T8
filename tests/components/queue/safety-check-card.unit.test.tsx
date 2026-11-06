// @vitest-environment jsdom
// US44: one event as the Safety Officer reviews it, and the decision form while it is waiting.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SafetyCheckCard } from "../../../components/safety/SafetyCheckCard";
import type { SafetyCheck } from "../../../lib/types";
import { fakeApp } from "../../helpers/fake-app";

let app = fakeApp({ state: { role: "safety" } });
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));

const area = (key: string, over = {}) => ({ key, label: `Area ${key}`, details: [`${key} detail`], concerns: [], recorded: true, ...over });
const check = (over: Partial<SafetyCheck> = {}): SafetyCheck => ({
  eventId: 7, name: "Design Keynote", status: "pending_safety_review", date: "2027-01-04", start: "10:00:00", end: "12:00:00",
  eventType: "talk", purpose: "A talk on design.", organiser: "Maya Rahman", coordinator: "Priya Tan",
  requestedAt: "2027-01-01T09:00:00Z", arrangementsIssue: null, areas: [area("a")], reviews: [], targets: [], ...over,
});

beforeEach(() => { app = fakeApp({ state: { role: "safety" }, decideSafetyCheck: vi.fn().mockResolvedValue(true) }); });

it("shows the event, its times, people and how long it has been waiting", () => {
  render(<SafetyCheckCard check={check()} />);
  expect(screen.getByLabelText("Safety check: Design Keynote")).toBeTruthy();
  expect(screen.getByText(/2027-01-04, 10:00–12:00 · organiser Maya Rahman · coordinator Priya Tan · waiting since/)).toBeTruthy();
  expect(screen.getByText("A talk on design.")).toBeTruthy();
});

it("copes with missing times, coordinator, request time and purpose", () => {
  render(<SafetyCheckCard check={check({ start: null, end: null, coordinator: null, requestedAt: null, purpose: "" })} />);
  expect(screen.getByText("2027-01-04 · organiser Maya Rahman · coordinator none")).toBeTruthy();
  expect(screen.queryByText("A talk on design.")).toBeNull();
});

it("shows a start time without an end time as a blank end", () => {
  render(<SafetyCheckCard check={check({ end: null, requestedAt: null })} />);
  expect(screen.getByText("2027-01-04, 10:00– · organiser Maya Rahman · coordinator Priya Tan")).toBeTruthy();
});

it("shows an unreadable request time as it was sent", () => {
  render(<SafetyCheckCard check={check({ requestedAt: "not a date" })} />);
  expect(screen.getByText(/waiting since not a date/)).toBeTruthy();
});

it("counts the concerns while waiting, in the singular and the plural", () => {
  const one = render(<SafetyCheckCard check={check({ areas: [area("a", { concerns: ["Exit blocked"] })] })} />);
  expect(screen.getByText("1 concern flagged")).toBeTruthy();
  expect(screen.getByLabelText("Area a: concerns").textContent).toBe("Exit blocked");
  one.unmount();
  render(<SafetyCheckCard check={check({ areas: [area("a", { concerns: ["x", "y"] }), area("b", { recorded: false })] })} />);
  expect(screen.getByText("2 concerns flagged")).toBeTruthy();
  expect(screen.getByText("Not recorded")).toBeTruthy();
});

it("shows no concern count when nothing is flagged or when the check is already decided", () => {
  const none = render(<SafetyCheckCard check={check()} />);
  expect(screen.queryByText(/concern/)).toBeNull();
  none.unmount();
  render(<SafetyCheckCard check={check({ status: "safety_approved", areas: [area("a", { concerns: ["Old concern"] })] })} />);
  expect(screen.queryByText(/concerns? flagged/)).toBeNull();
});

it("warns when the arrangements are no longer confirmed, only while waiting", () => {
  const waiting = render(<SafetyCheckCard check={check({ arrangementsIssue: "The venue booking was cancelled." })} />);
  expect(screen.getByRole("alert").textContent).toContain("The venue booking was cancelled.");
  waiting.unmount();
  render(<SafetyCheckCard check={check({ status: "safety_rejected", arrangementsIssue: "The venue booking was cancelled." })} />);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("shows the safety history with and without a comment", () => {
  render(<SafetyCheckCard check={check({
    status: "safety_changes_requested",
    reviews: [
      { outcome: "changes_requested", comment: "Widen the exit", reviewer: "Hannah Lau", reviewedAt: "2027-01-02T10:00:00Z" },
      { outcome: "approved", comment: null, reviewer: "Hannah Lau", reviewedAt: "2027-01-03T10:00:00Z" },
    ],
  })} />);
  expect(screen.getByText("Safety history")).toBeTruthy();
  expect(screen.getByText("Changes requested")).toBeTruthy();
  expect(screen.getByText("Approved")).toBeTruthy();
  expect(screen.getByText("Widen the exit")).toBeTruthy();
});

it("shows no decision form and no history when the check is decided and has no reviews", () => {
  render(<SafetyCheckCard check={check({ status: "safety_approved" })} />);
  expect(screen.queryByText("Approve")).toBeNull();
  expect(screen.queryByText("Safety history")).toBeNull();
});

it("approves without a comment and sends no arrangements to reassess", async () => {
  render(<SafetyCheckCard check={check({ targets: [{ type: "venue", id: 3, label: "Hall A" }] })} />);
  fireEvent.click(screen.getByLabelText("Reassess Hall A")); // ticked, but approval flags nothing
  await act(async () => { fireEvent.click(screen.getByText("Approve")); });
  expect(app.decideSafetyCheck).toHaveBeenCalledWith(7, "approved", "", []);
});

it("requires a comment to reject or request changes, then sends the ticked arrangements", async () => {
  render(<SafetyCheckCard check={check({ targets: [{ type: "venue", id: 3, label: "Hall A" }, { type: "equipment", id: 4, label: "Projector" }] })} />);
  fireEvent.click(screen.getByText("Reject"));
  expect(screen.getByRole("alert").textContent).toBe("A comment is required when rejecting or requesting changes.");
  expect(app.decideSafetyCheck).not.toHaveBeenCalled();

  fireEvent.click(screen.getByLabelText("Reassess Hall A"));
  fireEvent.click(screen.getByLabelText("Reassess Projector"));
  fireEvent.click(screen.getByLabelText("Reassess Hall A")); // untick again
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Exit too narrow" } });
  await act(async () => { fireEvent.click(screen.getByText("Request changes")); });
  expect(app.decideSafetyCheck).toHaveBeenCalledWith(7, "changes_requested", "Exit too narrow", [{ type: "equipment", id: 4 }]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect((screen.getByLabelText("Comment") as HTMLTextAreaElement).value).toBe(""); // cleared after a saved decision
});

it("keeps the comment when the decision could not be saved", async () => {
  app = fakeApp({ state: { role: "safety" }, decideSafetyCheck: vi.fn().mockResolvedValue(false) });
  render(<SafetyCheckCard check={check()} />);
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Unsafe" } });
  await act(async () => { fireEvent.click(screen.getByText("Reject")); });
  expect(app.decideSafetyCheck).toHaveBeenCalledWith(7, "rejected", "Unsafe", []);
  expect((screen.getByLabelText("Comment") as HTMLTextAreaElement).value).toBe("Unsafe");
});

it("disables the buttons while a decision is being saved", async () => {
  let finish!: (v: boolean) => void;
  app = fakeApp({ state: { role: "safety" }, decideSafetyCheck: vi.fn(() => new Promise<boolean>((a) => { finish = a; })) });
  render(<SafetyCheckCard check={check()} />);
  fireEvent.click(screen.getByText("Approve"));
  expect((screen.getByText("Approve") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish(true));
  expect((screen.getByText("Approve") as HTMLButtonElement).disabled).toBe(false);
});

it("lists no arrangements when the check has no targets", () => {
  render(<SafetyCheckCard check={check({ targets: undefined })} />);
  expect(screen.getByText("Arrangements requiring revision")).toBeTruthy();
  expect(screen.queryByRole("checkbox")).toBeNull();
});
