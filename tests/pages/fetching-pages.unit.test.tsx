// @vitest-environment jsdom
/**
 * The dashboard pages that load from the server themselves: equipment (Technical Support's requests),
 * registrations (US32, with CSV export), venues (US18/US20, read-only details) and one organiser event
 * (US15, my-events/[id]). The components they show belong to other chunks and are stubbed.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EquipmentPage from "../../app/(dashboard)/equipment/page";
import RegistrationsPage from "../../app/(dashboard)/registrations/page";
import VenuesPage from "../../app/(dashboard)/venues/page";
import EventDetailsPage from "../../app/(dashboard)/my-events/[id]/page";
import { ApiError } from "../../lib/api/client";
import type { EventRecord, RegistrationRecord, Venue } from "../../lib/types";
import { fakeApp } from "../helpers/fake-app";
import { navState, resetNext } from "../helpers/next-mocks";
import { makeEvent, makeRegistration } from "./fixtures";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));
vi.mock("next/navigation", async () => (await import("../helpers/next-mocks")).nextNavigation);
vi.mock("next/link", async () => (await import("../helpers/next-mocks")).nextLink);

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/client")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

vi.mock("@/components/equipment/EquipmentRequestCard", () => ({ EquipmentRequestCard: ({ event }: { event: EventRecord }) => <div>equipment card {event.name}</div> }));

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; rows: RegistrationRecord[] };
let registrations: Load = { state: "loading" };
const loadedFor = vi.fn();
vi.mock("@/components/registrations/useEventRegistrations", () => ({
  useEventRegistrations: (event: EventRecord | undefined) => {
    loadedFor(event?.id);
    return registrations;
  },
}));

let lastSearch: ((v: Venue[] | null) => void) | null = null;
vi.mock("@/components/venues/VenueSearch", () => ({
  VenueSearch: ({ onResults }: { onResults: (v: Venue[] | null) => void }) => {
    lastSearch = onResults;
    return <div>venue search</div>;
  },
}));
vi.mock("@/components/venues/VenueDetails", () => ({ VenueDetails: ({ venue }: { venue: Venue }) => <div>details of {venue.name}</div> }));

vi.mock("@/components/ui/EventDetails", () => ({ EventDetails: ({ event }: { event: EventRecord }) => <div>event details {event.name}</div> }));
vi.mock("@/components/ui/ClarificationThread", () => ({ ClarificationThread: () => <div>clarification thread</div> }));
vi.mock("@/components/ui/StatusHistory", () => ({ StatusHistoryToggle: () => <div>status history</div> }));
vi.mock("@/components/my-events/ChangeRequests", () => ({ ChangeRequests: ({ eventId }: { eventId: number }) => <div>change requests {eventId}</div> }));

beforeEach(() => {
  resetNext();
  apiFetch.mockReset();
  loadedFor.mockReset();
  registrations = { state: "loading" };
  lastSearch = null;
  app = fakeApp();
});

const flush = () => act(async () => {});

describe("EquipmentPage", () => {
  const requests = [
    { id: 1, name: "Career Fair", date: "2027-01-04", start: "10:00", end: "12:00" },
    { id: 2, name: "Gala Dinner", date: "2027-01-05", start: "18:00", end: "21:00" },
  ];

  it("shows Loading… until the requests arrive, then the first one", async () => {
    apiFetch.mockResolvedValue(requests);
    app = fakeApp({ state: { role: "tech", events: [makeEvent({ backendId: 1, name: "Career Fair" })] } });
    render(<EquipmentPage />);
    expect(screen.getByText("Loading requests…")).toBeTruthy();

    await flush();

    expect(apiFetch).toHaveBeenCalledWith("/equipment/requests");
    expect(screen.getByText("2027-01-04 · 10:00–12:00")).toBeTruthy();
    expect(screen.getByText("equipment card Career Fair")).toBeTruthy();
  });

  it("switches to another request, which may not be in the event list yet", async () => {
    apiFetch.mockResolvedValue(requests);
    app = fakeApp({ state: { role: "tech", events: [makeEvent({ backendId: 1, name: "Career Fair" })] } });
    render(<EquipmentPage />);
    await flush();

    fireEvent.change(screen.getByLabelText("Assigned event"), { target: { value: "2" } });

    expect(screen.getByText("2027-01-05 · 18:00–21:00")).toBeTruthy();
    expect(screen.queryByText(/equipment card/)).toBeNull();
  });

  it("says when nothing is assigned", async () => {
    apiFetch.mockResolvedValue([]);
    render(<EquipmentPage />);
    await flush();
    expect(screen.getByText("No equipment requests are assigned to you.")).toBeTruthy();
  });

  it("shows why the requests could not load", async () => {
    apiFetch.mockRejectedValue(new Error("Not allowed."));
    render(<EquipmentPage />);
    await flush();
    expect(screen.getByRole("alert").textContent).toBe("Not allowed.");
    expect(screen.getByText("No equipment requests are assigned to you.")).toBeTruthy();
  });
});

describe("RegistrationsPage", () => {
  const talk = makeEvent({ id: "EVT-1", name: "Career Fair", reg: true, regCap: 100, registered: 2, coordinator: "Priya Tan" });
  const gala = makeEvent({ id: "EVT-2", name: "Gala Dinner", reg: true, regCap: 50, registered: 0, organiser: "Maya Rahman", coordinator: "Marcus Lee" });
  const noReg = makeEvent({ id: "EVT-3", name: "No registration", reg: false });
  const rows = [
    makeRegistration({ id: "R-1", attendeeName: 'Sam "Sammy" Adeyemi', status: "registered" }),
    makeRegistration({ id: "R-2", attendeeName: "Lee Wei", attendeeEmail: "lee@x.edu", status: "waitlisted" }),
  ];

  it("says so when you manage no event with registration", () => {
    app = fakeApp({ state: { role: "organiser", events: [noReg] } });
    render(<RegistrationsPage />);
    expect(screen.getByText("You do not manage any events with registration access.")).toBeTruthy();
  });

  it("lists a coordinator's assigned events only, and shows loading", () => {
    app = fakeApp({ state: { role: "coordinator", events: [talk, gala, noReg] } });
    render(<RegistrationsPage />);

    expect(screen.getAllByRole("option").filter((o) => o.closest("select")?.value === "EVT-1").map((o) => o.textContent)).toEqual(["Career Fair"]);
    expect(screen.getByText("Loading registrations…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export CSV" })).toHaveProperty("disabled", true);
    expect(screen.getByText("2 / 100 places filled")).toBeTruthy();
    expect(loadedFor).toHaveBeenCalledWith("EVT-1");
  });

  it("lists an organiser's events, switches between them and filters by status", () => {
    registrations = { state: "ready", rows };
    app = fakeApp({ state: { role: "organiser", events: [talk, gala] } });
    const { container } = render(<RegistrationsPage />);
    const [eventSelect, statusSelect] = Array.from(container.querySelectorAll("select"));

    expect(screen.getByText("2 matching records")).toBeTruthy();
    expect(screen.getByText("Lee Wei")).toBeTruthy();

    fireEvent.change(statusSelect, { target: { value: "waitlisted" } });
    expect(screen.getByText("1 matching records")).toBeTruthy();
    expect(screen.queryByText('Sam "Sammy" Adeyemi')).toBeNull();

    fireEvent.change(statusSelect, { target: { value: "cancelled" } });
    expect(screen.getByText("No registrations match this filter.")).toBeTruthy();

    fireEvent.change(eventSelect, { target: { value: "EVT-2" } });
    expect(loadedFor).toHaveBeenLastCalledWith("EVT-2");
    expect(screen.getByText("0 / 50 places filled")).toBeTruthy();
  });

  it("shows why the registrations could not load", () => {
    registrations = { state: "error", message: "You can't see this event's registrations." };
    app = fakeApp({ state: { role: "organiser", events: [talk] } });
    render(<RegistrationsPage />);

    expect(screen.getByText("You can't see this event's registrations.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  describe("CSV export", () => {
    let blobs: Blob[] = [];
    let clicked: HTMLAnchorElement[] = [];

    beforeEach(() => {
      blobs = [];
      clicked = [];
      URL.createObjectURL = vi.fn((b: Blob) => {
        blobs.push(b);
        return "blob:csv";
      });
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this);
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it("exports the matching rows, quoting every value", async () => {
      registrations = { state: "ready", rows };
      app = fakeApp({ state: { role: "organiser", events: [talk] } });
      render(<RegistrationsPage />);

      fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

      expect(clicked[0].download).toBe("EVT-1-registrations.csv");
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:csv");
      expect((await blobs[0].text()).split("\n")).toEqual([
        "Name,Email,Status,Registered at",
        '"Sam ""Sammy"" Adeyemi","sam.adeyemi@student.connectsphere.edu","registered","2027-01-01T09:00:00Z"',
        '"Lee Wei","lee@x.edu","waitlisted","2027-01-01T09:00:00Z"',
      ]);
    });
  });
});

describe("VenuesPage", () => {
  const hall = { id: "1", name: "Hall A", location: "Block A", cap: 200, isActive: true } as Venue;
  const room = { id: "2", name: "Room 2", location: "Block B", cap: 40, isActive: true } as Venue;
  const shut = { id: "3", name: "Closed Hall", location: "Block C", cap: 90, isActive: false } as Venue;
  const apiVenue = { id: 1, name: "Hall A", location: "Block A", cap: 200, layouts: [], facilities: [], accessibility: [], operatingHours: "08:00 - 22:00", operatingDays: [], unavailability: [], setupMinutes: 0, turnaroundMinutes: 0, is_active: true, last_updated_by: "x", last_updated_at: "2027-01-01T00:00:00Z" };

  beforeEach(() => {
    app = fakeApp({ state: { venues: [hall, room, shut] } });
  });

  it("lists the active venues and asks you to choose one", () => {
    render(<VenuesPage />);

    expect(screen.getByText("Hall A")).toBeTruthy();
    expect(screen.getByText("Block A · capacity 200")).toBeTruthy();
    expect(screen.queryByText("Closed Hall")).toBeNull();
    expect(screen.getByText("Choose a venue to see its details.")).toBeTruthy();
  });

  it("says when the catalogue has no active venues", () => {
    app = fakeApp({ state: { venues: [shut] } });
    render(<VenuesPage />);
    expect(screen.getByText("No active venues in the catalogue.")).toBeTruthy();
  });

  it("loads and shows a venue's details", async () => {
    let finish!: (v: unknown) => void;
    apiFetch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<VenuesPage />);

    fireEvent.click(screen.getAllByRole("button", { name: "View details" })[0]);
    expect(screen.getByRole("button", { name: "Loading…" })).toHaveProperty("disabled", true);
    await act(async () => finish(apiVenue));

    expect(apiFetch).toHaveBeenCalledWith("/venues/1");
    expect(screen.getByText("details of Hall A")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "View details" })).toHaveLength(2);
  });

  it("warns and reloads when the venue has gone since the list loaded", async () => {
    apiFetch.mockRejectedValue(new ApiError(404, "Not found"));
    render(<VenuesPage />);

    fireEvent.click(screen.getAllByRole("button", { name: "View details" })[0]);
    await flush();

    expect(app.flash).toHaveBeenCalledWith("That venue is no longer available.", "warn");
    expect(app.reloadVenues).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Choose a venue to see its details.")).toBeTruthy();
  });

  it("hands any other error to the app", async () => {
    const err = new ApiError(500, "Server error");
    apiFetch.mockRejectedValue(err);
    render(<VenuesPage />);

    fireEvent.click(screen.getAllByRole("button", { name: "View details" })[0]);
    await flush();

    expect(app.handleApiError).toHaveBeenCalledWith(err);
    expect(app.reloadVenues).not.toHaveBeenCalled();
  });

  it("shows the search results, keeps the open venue if it is still found, and closes it if not", async () => {
    apiFetch.mockResolvedValue(apiVenue);
    render(<VenuesPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "View details" })[0]);
    await flush();

    act(() => lastSearch!([hall]));
    expect(screen.queryByText("Room 2")).toBeNull();
    expect(screen.getByText("details of Hall A")).toBeTruthy();

    act(() => lastSearch!([room]));
    expect(screen.getByText("Room 2")).toBeTruthy();
    expect(screen.getByText("Choose a venue to see its details.")).toBeTruthy();
  });

  it("shows no empty message for a search that found nothing, and goes back to the list when cleared", () => {
    render(<VenuesPage />);

    act(() => lastSearch!([]));
    expect(screen.queryByText("Hall A")).toBeNull();
    expect(screen.queryByText("No active venues in the catalogue.")).toBeNull();

    act(() => lastSearch!(null));
    expect(screen.getByText("Hall A")).toBeTruthy();
  });
});

describe("EventDetailsPage (my-events/[id])", () => {
  const stored = { id: 5, name: "Career Fair", status: "submitted" };

  it("refuses an id that isn't a positive whole number, without asking the server", () => {
    navState.params = { id: "abc" };
    render(<EventDetailsPage />);

    expect(screen.getByText("This event doesn't exist or isn't one of your requests.")).toBeTruthy();
    expect(screen.getByText("← My events").getAttribute("href")).toBe("/my-events");
    expect(app.loadEvent).not.toHaveBeenCalled();
  });

  it("shows an event already in the list, with its change requests", () => {
    navState.params = { id: "5" };
    const listed = makeEvent({ id: "EVT-5", backendId: 5, name: "Career Fair", status: "submitted" });
    app = fakeApp({ state: { role: "organiser" }, event: (id?: string | null) => (id === "EVT-5" ? listed : undefined) });
    render(<EventDetailsPage />);

    expect(screen.getByRole("heading", { name: "Career Fair" })).toBeTruthy();
    expect(screen.getByText("EVT-5")).toBeTruthy();
    for (const part of ["event details Career Fair", "clarification thread", "status history", "change requests 5"]) {
      expect(screen.getByText(part)).toBeTruthy();
    }
    expect(app.loadEvent).not.toHaveBeenCalled();
  });

  it("leaves out change requests for a draft", () => {
    navState.params = { id: "5" };
    const draft = makeEvent({ id: "EVT-5", backendId: 5, status: "draft" });
    app = fakeApp({ state: { role: "organiser" }, event: () => draft });
    render(<EventDetailsPage />);

    expect(screen.queryByText(/change requests/)).toBeNull();
  });

  it("fetches an event opened directly, showing Loading… until it arrives", async () => {
    navState.params = { id: "5" };
    let finish!: (v: unknown) => void;
    app = fakeApp({ state: { role: "organiser" }, loadEvent: vi.fn(() => new Promise<never>((resolve) => (finish = resolve as never))) });
    render(<EventDetailsPage />);
    expect(screen.getByText("Loading event…")).toBeTruthy();

    await act(async () => finish(stored));

    expect(app.loadEvent).toHaveBeenCalledWith(5);
    expect(screen.getByRole("heading", { name: "Career Fair" })).toBeTruthy();
  });

  it("says the event doesn't exist when the server refuses it", async () => {
    navState.params = { id: "6" };
    app = fakeApp({ state: { role: "organiser" }, loadEvent: vi.fn().mockRejectedValue(new ApiError(404, "Not found")) });
    render(<EventDetailsPage />);
    await flush();

    expect(screen.getByText("This event doesn't exist or isn't one of your requests.")).toBeTruthy();
  });

  it("ignores a reply that arrives after you have left the page", async () => {
    navState.params = { id: "5" };
    let finish!: (v: unknown) => void;
    let fail!: (e: unknown) => void;
    app = fakeApp({ state: { role: "organiser" }, loadEvent: vi.fn(() => new Promise<never>((resolve, reject) => ((finish = resolve as never), (fail = reject)))) });
    const first = render(<EventDetailsPage />);
    first.unmount();
    await act(async () => finish(stored));

    const second = render(<EventDetailsPage />);
    second.unmount();
    await act(async () => fail(new Error("late")));

    // Nothing was shown or thrown for either reply.
    expect(app.loadEvent).toHaveBeenCalledTimes(2);
  });
});
