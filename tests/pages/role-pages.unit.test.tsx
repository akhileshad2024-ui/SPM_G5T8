// @vitest-environment jsdom
/**
 * The smaller dashboard pages, each arranging what the app context holds:
 * board (Pipeline), browse, calendar, catalogue, my-events, new-request, queue and safety.
 * The components they show belong to other chunks and are stubbed.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BoardPage from "../../app/(dashboard)/board/page";
import BrowsePage from "../../app/(dashboard)/browse/page";
import CalendarPage from "../../app/(dashboard)/calendar/page";
import CataloguePage from "../../app/(dashboard)/catalogue/page";
import MyEventsPage from "../../app/(dashboard)/my-events/page";
import NewRequestPage from "../../app/(dashboard)/new-request/page";
import QueuePage from "../../app/(dashboard)/queue/page";
import SafetyPage from "../../app/(dashboard)/safety/page";
import type { EventRecord, SafetyCheck, Venue } from "../../lib/types";
import { fakeApp } from "../helpers/fake-app";
import { makeEvent, makeRegistration } from "./fixtures";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));
vi.mock("@/components/board/BoardColumn", () => ({
  BoardColumn: ({ label, cards }: { label: string; cards: EventRecord[] }) => (
    <div aria-label={`Column: ${label}`}>{cards.map((c) => c.name).join(", ")}</div>
  ),
}));
vi.mock("@/components/browse/PublicEventCard", () => ({ PublicEventCard: ({ event }: { event: EventRecord }) => <div>card {event.name}</div> }));
vi.mock("@/components/bookings/AvailabilityCalendar", () => ({ AvailabilityCalendar: () => <div>calendar</div> }));
vi.mock("@/components/catalogue/VenueCard", () => ({ VenueCard: ({ venue }: { venue: Venue }) => <div>venue {venue.name}</div> }));
vi.mock("@/components/catalogue/VenueForm", () => ({
  VenueForm: ({ onSuccess, onCancel }: { onSuccess: (r: { venue: { name: string } }) => void; onCancel: () => void }) => (
    <div>
      venue form
      <button onClick={() => onSuccess({ venue: { name: "Hall C" } })}>save venue</button>
      <button onClick={onCancel}>cancel venue</button>
    </div>
  ),
}));
vi.mock("@/components/my-events/MyEventsTable", () => ({
  MyEventsTable: ({ events }: { events: EventRecord[] }) => <div>table {events.map((e) => e.name).join(", ")}</div>,
}));
vi.mock("@/components/new-request/WizardSteps", () => ({ WizardSteps: ({ step }: { step: number }) => <div>wizard at {step}</div> }));
vi.mock("@/components/new-request/StepBasics", () => ({ StepBasics: () => <div>basics</div> }));
vi.mock("@/components/new-request/StepRequirements", () => ({ StepRequirements: () => <div>requirements</div> }));
vi.mock("@/components/new-request/StepRegistration", () => ({ StepRegistration: () => <div>registration</div> }));
vi.mock("@/components/queue/QueueList", () => ({
  QueueList: ({ events, selectedId }: { events: EventRecord[]; selectedId: string }) => (
    <div>list {events.map((e) => e.id).join(",")} selected {selectedId}</div>
  ),
}));
vi.mock("@/components/queue/EventWorkspace", () => ({ EventWorkspace: ({ event }: { event: EventRecord }) => <div>workspace {event.id}</div> }));
vi.mock("@/components/safety/SafetyCheckCard", () => ({ SafetyCheckCard: ({ check }: { check: SafetyCheck }) => <div>check {check.name}</div> }));

beforeEach(() => {
  app = fakeApp();
});

describe("BoardPage", () => {
  it("puts each event in its column, with clarification under review and every safety step under safety", () => {
    const at = (id: string, status: EventRecord["status"]) => makeEvent({ id, name: id, status });
    app = fakeApp({
      state: {
        events: [
          at("sub", "submitted"),
          at("rev", "under_review"),
          at("clar", "pending_clarification"),
          at("app", "approved"),
          at("s1", "pending_safety_review"),
          at("s2", "safety_changes_requested"),
          at("s3", "safety_approved"),
          at("s4", "safety_rejected"),
          at("conf", "confirmed"),
          at("draft", "draft"),
        ],
      },
    });
    render(<BoardPage />);

    expect(screen.getByLabelText("Column: Submitted").textContent).toBe("sub");
    expect(screen.getByLabelText("Column: Under review").textContent).toBe("rev, clar");
    expect(screen.getByLabelText("Column: Approved").textContent).toBe("app");
    expect(screen.getByLabelText("Column: Safety check").textContent).toBe("s1, s2, s3, s4");
    expect(screen.getByLabelText("Column: Confirmed").textContent).toBe("conf");
  });
});

describe("BrowsePage", () => {
  const confirmed = makeEvent({ id: "EVT-1", name: "Career Fair", status: "confirmed", reg: true });

  it("lists only confirmed events open for registration, and says when you have no registrations", () => {
    app = fakeApp({ state: { role: "attendee", events: [confirmed, makeEvent({ id: "EVT-2", name: "Approved only", reg: true })] } });
    render(<BrowsePage />);

    expect(screen.getByText("card Career Fair")).toBeTruthy();
    expect(screen.queryByText("card Approved only")).toBeNull();
    expect(screen.getByText("You have not registered for an event yet.")).toBeTruthy();
  });

  it("lists your registrations from the saved record, even for events no longer listed", () => {
    app = fakeApp({
      state: {
        role: "attendee",
        registrations: [
          makeRegistration({ id: "R-1", eventId: "EVT-9", eventName: "Old Talk", eventDate: "2027-02-01", eventStart: "09:00", eventEnd: "10:00", status: "waitlisted" }),
          makeRegistration({ id: "R-2", attendeeEmail: "someone@else.edu", eventName: "Not mine" }),
        ],
      },
    });
    render(<BrowsePage />);

    expect(screen.getByText("Old Talk")).toBeTruthy();
    expect(screen.getByText("2027-02-01 · 09:00–10:00")).toBeTruthy();
    expect(screen.getByText("waitlisted")).toBeTruthy();
    expect(screen.queryByText("Not mine")).toBeNull();
  });

  it("falls back to the event's details, and shows a cancelled event as cancelled", () => {
    const cancelled = makeEvent({ id: "EVT-3", name: "Cancelled Gala", status: "cancelled", date: "2027-03-01", start: "18:00", end: "20:00" });
    app = fakeApp({
      state: { role: "attendee", registrations: [makeRegistration({ eventId: "EVT-3" })] },
      event: (id?: string | null) => (id === "EVT-3" ? cancelled : undefined),
    });
    render(<BrowsePage />);

    expect(screen.getByText("Cancelled Gala")).toBeTruthy();
    expect(screen.getByText("2027-03-01 · 18:00–20:00")).toBeTruthy();
    expect(screen.getByText("cancelled")).toBeTruthy();
  });

  it("shows the event id when neither the record nor the list knows the event", () => {
    app = fakeApp({ state: { role: "attendee", registrations: [makeRegistration({ eventId: "EVT-404" })] } });
    render(<BrowsePage />);

    expect(screen.getByText("EVT-404")).toBeTruthy();
    expect(screen.getByText("registered")).toBeTruthy();
  });
});

describe("CalendarPage", () => {
  it("shows the venue availability calendar", () => {
    render(<CalendarPage />);
    expect(screen.getByText("calendar")).toBeTruthy();
  });
});

describe("CataloguePage", () => {
  const active = { id: "V1", name: "Hall A", isActive: true } as Venue;
  const inactive = { id: "V2", name: "Old Hall", isActive: false } as Venue;

  it("says there are no venues yet", () => {
    app = fakeApp({ state: { role: "venue" } });
    render(<CataloguePage />);
    expect(screen.getByText("No venues yet. Add one to get started.")).toBeTruthy();
    expect(screen.getByText("Show deactivated (0)")).toBeTruthy();
  });

  it("hides deactivated venues until asked", () => {
    app = fakeApp({ state: { role: "venue", venues: [active, inactive] } });
    render(<CataloguePage />);

    expect(screen.getByText("venue Hall A")).toBeTruthy();
    expect(screen.queryByText("venue Old Hall")).toBeNull();

    fireEvent.click(screen.getByLabelText("Show deactivated (1)"));
    expect(screen.getByText("venue Old Hall")).toBeTruthy();
  });

  it("adds a venue and says so, or cancels", () => {
    app = fakeApp({ state: { role: "venue", venues: [active] } });
    render(<CataloguePage />);

    fireEvent.click(screen.getByText("+ Add Venue"));
    fireEvent.click(screen.getByText("cancel venue"));
    expect(screen.queryByText("venue form")).toBeNull();
    expect(app.flash).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("+ Add Venue"));
    fireEvent.click(screen.getByText("save venue"));
    expect(screen.queryByText("venue form")).toBeNull();
    expect(app.flash).toHaveBeenCalledWith("Hall C added to the catalogue.");
  });
});

describe("MyEventsPage", () => {
  it("counts only the organiser's own events by stage", () => {
    const mine = (id: string, status: EventRecord["status"]) => makeEvent({ id, name: id, status });
    app = fakeApp({
      state: {
        role: "organiser",
        events: [
          mine("d1", "draft"),
          mine("s1", "submitted"),
          mine("r1", "under_review"),
          mine("c1", "pending_clarification"),
          mine("a1", "approved"),
          mine("a2", "approved"),
          mine("f1", "confirmed"),
          makeEvent({ id: "x", name: "someone else's", organiser: "Other Person", status: "draft" }),
        ],
      },
    });
    render(<MyEventsPage />);

    const stat = (label: string) => screen.getByText(label).previousElementSibling?.textContent;
    expect(stat("Drafts")).toBe("1");
    expect(stat("Awaiting decision")).toBe("3");
    expect(stat("Approved")).toBe("2");
    expect(stat("Confirmed")).toBe("1");
    expect(screen.getByText("table d1, s1, r1, c1, a1, a2, f1")).toBeTruthy();
  });
});

describe("NewRequestPage", () => {
  it("starts at step 1 with no Back button and nothing to fix", () => {
    app = fakeApp({ state: { role: "organiser", step: 1 } });
    render(<NewRequestPage />);

    expect(screen.getByText("wizard at 1")).toBeTruthy();
    expect(screen.getByText("basics")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    expect(app.nextStep).toHaveBeenCalledTimes(1);
    expect(app.saveDraft).toHaveBeenCalledTimes(1);
  });

  it("shows step 2 with Back", () => {
    app = fakeApp({ state: { role: "organiser", step: 2 } });
    render(<NewRequestPage />);

    expect(screen.getByText("requirements")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(app.backStep).toHaveBeenCalledTimes(1);
  });

  it("submits from step 3 and lists what to fix first", () => {
    app = fakeApp({ state: { role: "organiser", step: 3, formErrors: { name: "Enter the event name.", date: "Choose a date." } } });
    render(<NewRequestPage />);

    expect(screen.getByText("registration")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeTruthy();
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Fix before submitting")).toBeTruthy();
    expect(within(alert).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Enter the event name.", "Choose a date."]);
  });

  it("locks the buttons while a draft is saving", () => {
    app = fakeApp({ state: { role: "organiser", step: 2 }, isSavingDraft: true });
    render(<NewRequestPage />);

    expect(screen.getByRole("button", { name: "Saving..." })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Back" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", true);
  });
});

describe("QueuePage", () => {
  const ev = (id: string) => makeEvent({ id, status: "submitted", coordinator: "Priya Tan" });

  it("opens the selected event when it is in the list", () => {
    const list = [ev("EVT-1"), ev("EVT-2")];
    app = fakeApp({ state: { events: list, queueFilter: "all", selectedId: "EVT-2" }, event: (id?: string | null) => list.find((e) => e.id === id) });
    render(<QueuePage />);

    expect(screen.getByText("list EVT-1,EVT-2 selected EVT-2")).toBeTruthy();
    expect(screen.getByText("workspace EVT-2")).toBeTruthy();
  });

  it("falls back to the first event when the selected one is filtered out", () => {
    const list = [ev("EVT-1")];
    app = fakeApp({ state: { events: list, queueFilter: "all", selectedId: "EVT-9" }, event: (id?: string | null) => list.find((e) => e.id === id) });
    render(<QueuePage />);

    expect(screen.getByText("workspace EVT-1")).toBeTruthy();
  });

  it("says so when nothing matches the filter", () => {
    app = fakeApp({ state: { events: [], queueFilter: "all", selectedId: "EVT-9" } });
    render(<QueuePage />);

    expect(screen.getByText(/^list +selected EVT-9$/)).toBeTruthy();
    expect(screen.getByText("No events match this filter.")).toBeTruthy();
  });
});

describe("SafetyPage", () => {
  const check = (eventId: number, name: string, status: SafetyCheck["status"]) => ({ eventId, name, status }) as SafetyCheck;

  it("splits the checks into awaiting and already reviewed", () => {
    app = fakeApp({ state: { role: "safety", safetyChecks: [check(1, "Career Fair", "pending_safety_review"), check(2, "Gala", "safety_approved")] } });
    render(<SafetyPage />);

    expect(within(screen.getByLabelText("Awaiting a safety check")).getByText("check Career Fair")).toBeTruthy();
    expect(within(screen.getByLabelText("Already reviewed")).getByText("check Gala")).toBeTruthy();
    expect(screen.getByText("Awaiting a safety check (1)")).toBeTruthy();
    expect(screen.getByText("Already reviewed (1)")).toBeTruthy();
  });

  it("says so when there is nothing to check or reviewed", () => {
    app = fakeApp({ state: { role: "safety" } });
    render(<SafetyPage />);

    expect(screen.getByText("No events are waiting for a safety check.")).toBeTruthy();
    expect(screen.getByText("Nothing has been reviewed yet.")).toBeTruthy();
  });
});
