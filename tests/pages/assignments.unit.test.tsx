// @vitest-environment jsdom
/**
 * app/(dashboard)/assignments/page.tsx: the Event Coordinator Lead's page (US43, US11, US12). Assigning
 * an unassigned request, reassigning a coordinator's event with a reason, and opening its assignment history.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AssignmentsPage from "../../app/(dashboard)/assignments/page";
import { fakeApp } from "../helpers/fake-app";
import { makeEvent } from "./fixtures";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));
vi.mock("@/components/ui/EventDetails", () => ({ EventDetailsToggle: () => <div>details toggle</div> }));

const coordinators = [
  { id: 1, name: "Priya Tan" },
  { id: 2, name: "Marcus Lee" },
];
const assigned = makeEvent({ id: "EVT-1", backendId: 1, name: "Career Fair", coordinator: "Priya Tan" });
const unassigned = makeEvent({ id: "EVT-2", backendId: 2, name: "Gala Dinner", coordinator: null, start: "18:00", end: "21:00" });

function lead(overrides: Parameters<typeof fakeApp>[0] = {}) {
  app = fakeApp({ ...overrides, state: { role: "lead", coordinators, events: [assigned, unassigned], ...overrides.state } });
}

beforeEach(() => lead());

const row = (name: string) => screen.getByLabelText(`Assigned event: ${name}`);

describe("AssignmentsPage: unassigned requests", () => {
  it("lists each unassigned request and assigns the chosen coordinator", () => {
    render(<AssignmentsPage />);

    const card = screen.getByLabelText("Unassigned request: Gala Dinner");
    expect(screen.getByText("Unassigned requests (1)")).toBeTruthy();
    expect(within(card).getByText("EVT-2 · Maya Rahman · 2027-01-04, 18:00–21:00 · 120 expected")).toBeTruthy();
    expect(within(card).getByText("details toggle")).toBeTruthy();

    const assign = within(card).getByRole("button", { name: "Assign" });
    expect(assign).toHaveProperty("disabled", true);
    fireEvent.change(within(card).getByLabelText("Coordinator to assign"), { target: { value: "Marcus Lee" } });
    fireEvent.click(assign);

    expect(app.assignCoordinator).toHaveBeenCalledWith("EVT-2", "Marcus Lee");
  });

  it("leaves out the time when a request has none", () => {
    lead({ state: { events: [{ ...unassigned, start: "", end: "" }] } });
    render(<AssignmentsPage />);
    expect(screen.getByText("EVT-2 · Maya Rahman · 2027-01-04 · 120 expected")).toBeTruthy();
  });

  it("says so when every request has a coordinator, and when a coordinator has nothing", () => {
    lead({ state: { events: [assigned] } });
    render(<AssignmentsPage />);

    expect(screen.getByText("Every request has a coordinator.")).toBeTruthy();
    expect(within(screen.getByLabelText("Coordinator: Priya Tan")).getByText("1 active")).toBeTruthy();
    expect(within(screen.getByLabelText("Coordinator: Marcus Lee")).getByText("No active events.")).toBeTruthy();
  });
});

describe("AssignmentsPage: reassigning", () => {
  it("offers every other coordinator and needs one chosen", () => {
    render(<AssignmentsPage />);
    fireEvent.click(within(row("Career Fair")).getByRole("button", { name: "Reassign" }));

    const options = within(row("Career Fair")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Reassign to…", "Marcus Lee"]);
    expect(within(row("Career Fair")).getByRole("button", { name: "Confirm reassignment" })).toHaveProperty("disabled", true);

    fireEvent.click(within(row("Career Fair")).getByRole("button", { name: "Cancel" }));
    expect(within(row("Career Fair")).queryByLabelText("Reassign to")).toBeNull();
  });

  it("reassigns with the reason and closes the form when the server agrees", async () => {
    lead({ reassignCoordinator: vi.fn().mockResolvedValue(true) });
    render(<AssignmentsPage />);
    const r = row("Career Fair");
    fireEvent.click(within(r).getByRole("button", { name: "Reassign" }));
    fireEvent.change(within(r).getByLabelText("Reassign to"), { target: { value: "Marcus Lee" } });
    fireEvent.change(within(r).getByLabelText("Reason for reassignment"), { target: { value: "Priya is on leave." } });

    await act(async () => {
      fireEvent.click(within(r).getByRole("button", { name: "Confirm reassignment" }));
    });

    expect(app.reassignCoordinator).toHaveBeenCalledWith("EVT-1", "Marcus Lee", "Priya is on leave.");
    expect(within(r).queryByLabelText("Reassign to")).toBeNull();
  });

  it("keeps the form open, with what was typed, when the server refuses", async () => {
    lead({ reassignCoordinator: vi.fn().mockResolvedValue(false) });
    render(<AssignmentsPage />);
    const r = row("Career Fair");
    fireEvent.click(within(r).getByRole("button", { name: "Reassign" }));
    fireEvent.change(within(r).getByLabelText("Reassign to"), { target: { value: "Marcus Lee" } });

    await act(async () => {
      fireEvent.click(within(r).getByRole("button", { name: "Confirm reassignment" }));
    });

    expect((within(r).getByLabelText("Reassign to") as HTMLSelectElement).value).toBe("Marcus Lee");
    expect(within(r).getByRole("button", { name: "Confirm reassignment" })).toHaveProperty("disabled", false);
  });
});

describe("AssignmentsPage: history", () => {
  it("opens the history, newest assignment wording included, and hides it again", async () => {
    lead({
      loadAssignmentHistory: vi.fn().mockResolvedValue([
        { coordinator: "Priya Tan", previousCoordinator: null, assignedBy: "Grace Ong", assignedAt: "2026-11-02T06:05:00Z", reason: null },
        { coordinator: "Marcus Lee", previousCoordinator: "Priya Tan", assignedBy: "Grace Ong", assignedAt: "not a date", reason: "On leave" },
      ]),
    });
    render(<AssignmentsPage />);
    const r = row("Career Fair");

    await act(async () => {
      fireEvent.click(within(r).getByRole("button", { name: "History" }));
    });

    expect(app.loadAssignmentHistory).toHaveBeenCalledWith(1);
    const list = screen.getByLabelText("Assignment history: Career Fair");
    expect(list.textContent).toContain("Grace Ong assigned Priya Tan");
    expect(list.textContent).toContain("2026");
    // A time the browser can't read is shown as sent.
    expect(list.textContent).toContain("not a date — Grace Ong reassigned it from Priya Tan to Marcus Lee: On leave");

    fireEvent.click(within(r).getByRole("button", { name: "Hide history" }));
    expect(screen.queryByLabelText("Assignment history: Career Fair")).toBeNull();
  });

  it("says when no assignments are recorded", async () => {
    lead({ loadAssignmentHistory: vi.fn().mockResolvedValue([]) });
    render(<AssignmentsPage />);

    await act(async () => {
      fireEvent.click(within(row("Career Fair")).getByRole("button", { name: "History" }));
    });

    expect(screen.getByText("No assignments recorded.")).toBeTruthy();
  });

  it("does nothing for an event that isn't saved yet", async () => {
    lead({ state: { events: [{ ...assigned, backendId: undefined }] } });
    render(<AssignmentsPage />);

    await act(async () => {
      fireEvent.click(within(row("Career Fair")).getByRole("button", { name: "History" }));
    });

    expect(app.loadAssignmentHistory).not.toHaveBeenCalled();
  });

  it("hands a failed load to the app", async () => {
    const err = new Error("Network down");
    lead({ loadAssignmentHistory: vi.fn().mockRejectedValue(err) });
    render(<AssignmentsPage />);

    await act(async () => {
      fireEvent.click(within(row("Career Fair")).getByRole("button", { name: "History" }));
    });

    expect(app.handleApiError).toHaveBeenCalledWith(err);
    expect(screen.queryByLabelText("Assignment history: Career Fair")).toBeNull();
  });

  it("closes an open history after a successful reassignment", async () => {
    lead({
      loadAssignmentHistory: vi.fn().mockResolvedValue([]),
      reassignCoordinator: vi.fn().mockResolvedValue(true),
    });
    render(<AssignmentsPage />);
    const r = row("Career Fair");
    await act(async () => {
      fireEvent.click(within(r).getByRole("button", { name: "History" }));
    });
    fireEvent.click(within(r).getByRole("button", { name: "Reassign" }));
    fireEvent.change(within(r).getByLabelText("Reassign to"), { target: { value: "Marcus Lee" } });

    await act(async () => {
      fireEvent.click(within(r).getByRole("button", { name: "Confirm reassignment" }));
    });

    expect(screen.queryByLabelText("Assignment history: Career Fair")).toBeNull();
  });
});
