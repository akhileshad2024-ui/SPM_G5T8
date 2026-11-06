// @vitest-environment jsdom
/**
 * app/(dashboard)/bookings/page.tsx: Venue Staff's booking requests. Confirmed bookings in trouble,
 * US49 reassessment panels, US38 bookings requiring reassessment, US47 competing requests, the pending
 * requests and US42 expired holds. The components and venue rules come from other chunks and are stubbed.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BookingsPage from "../../app/(dashboard)/bookings/page";
import { fakeApp } from "../helpers/fake-app";
import { makeBooking, makeEvent } from "./fixtures";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));
vi.mock("@/components/bookings/AvailabilityCalendar", () => ({ AvailabilityCalendar: () => <div>calendar</div> }));
vi.mock("@/components/bookings/BookingRequestCard", () => ({
  BookingRequestCard: ({ booking }: { booking: { id: number } }) => <div>request card {booking.id}</div>,
}));
vi.mock("@/components/bookings/ConflictList", () => ({ ConflictList: () => <div>conflict list</div> }));
vi.mock("@/components/queue/ReassessmentPanel", () => ({
  ReassessmentPanel: ({ eventId, heading }: { eventId: number; heading: string }) => <div>panel {eventId}: {heading}</div>,
}));

let problems: Record<string, Array<{ text: string }>> = {};
vi.mock("@/lib/venues/rules", () => ({ bookingProblems: () => problems }));

beforeEach(() => {
  problems = {};
  app = fakeApp({ state: { role: "venue" } });
});

describe("BookingsPage", () => {
  it("shows only the calendar and an empty list when nothing is waiting", () => {
    render(<BookingsPage />);

    expect(screen.getByText("calendar")).toBeTruthy();
    expect(screen.getByText("No booking requests are waiting on you.")).toBeTruthy();
    for (const heading of ["Confirmed bookings needing attention", "Bookings requiring reassessment", "Expired holds"]) {
      expect(screen.queryByText(heading)).toBeNull();
    }
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("lists one card per pending booking, across events", () => {
    app = fakeApp({
      state: {
        role: "venue",
        events: [
          makeEvent({ id: "EVT-1", bookings: [makeBooking({ id: 1 }), makeBooking({ id: 2, status: "rejected" })] }),
          makeEvent({ id: "EVT-2", backendId: 2, bookings: [makeBooking({ id: 3 })] }),
          makeEvent({ id: "EVT-3", backendId: 3 }),
        ],
      },
    });
    render(<BookingsPage />);

    expect(screen.getByText("request card 1")).toBeTruthy();
    expect(screen.getByText("request card 3")).toBeTruthy();
    expect(screen.queryByText("request card 2")).toBeNull();
    expect(screen.queryByText("No booking requests are waiting on you.")).toBeNull();
  });

  it("gives a reassessment panel only to saved events holding a venue (US49)", () => {
    app = fakeApp({
      state: {
        role: "venue",
        events: [
          makeEvent({ id: "EVT-1", backendId: 1, name: "Career Fair", bookings: [makeBooking({ status: "approved" })] }),
          makeEvent({ id: "EVT-2", backendId: undefined, name: "Sample", bookings: [makeBooking({ id: 2 })] }),
          makeEvent({ id: "EVT-3", backendId: 3, name: "Released", bookings: [makeBooking({ id: 3, status: "cancelled" })] }),
        ],
      },
    });
    render(<BookingsPage />);

    expect(screen.getByLabelText("Venue reassessment: Career Fair").textContent).toBe("panel 1: Requires reassessment: Career Fair");
    expect(screen.queryByLabelText("Venue reassessment: Sample")).toBeNull();
    expect(screen.queryByLabelText("Venue reassessment: Released")).toBeNull();
  });

  it("warns about one pending request that competes with another (US47)", () => {
    const clash = makeBooking({ conflicts: [{ kind: "pending_request" }] as never });
    app = fakeApp({ state: { role: "venue", events: [makeEvent({ bookings: [clash] })] } });
    render(<BookingsPage />);

    expect(screen.getByRole("status").textContent).toContain("1 pending request conflicts with another pending request.");
  });

  it("uses the plural for several competing requests", () => {
    const clash = (id: number) => makeBooking({ id, conflicts: [{ kind: "pending_request" }] as never });
    app = fakeApp({ state: { role: "venue", events: [makeEvent({ bookings: [clash(1), clash(2)] })] } });
    render(<BookingsPage />);

    expect(screen.getByRole("status").textContent).toContain("2 pending requests conflict with another pending request.");
  });

  it("lists confirmed bookings a venue change has put in trouble, unless US38 already lists them", () => {
    const flagged = { message: "Setup time now overlaps.", clashes_with: [] };
    problems = { "EVT-1": [{ text: "The venue is unavailable that day." }], "EVT-2": [{ text: "Listed below instead." }], "EVT-3": [{ text: "Not booked." }] };
    app = fakeApp({
      state: {
        role: "venue",
        events: [
          makeEvent({ id: "EVT-1", name: "Career Fair", venue: "V1", bookingState: "approved", bookings: [], coordinator: null }),
          makeEvent({ id: "EVT-2", name: "Gala", bookingState: "approved", bookings: [makeBooking({ status: "approved", reassessment: flagged as never })] }),
          makeEvent({ id: "EVT-3", name: "Pending one", bookingState: "pending" }),
          makeEvent({ id: "EVT-4", name: "Fine", bookingState: "approved" }),
        ],
      },
      venue: (id?: string | null) => (id === "V1" ? ({ name: "Hall A" } as never) : undefined),
    });
    render(<BookingsPage />);

    expect(screen.getByText("Confirmed bookings needing attention")).toBeTruthy();
    expect(screen.getByText("Career Fair · Hall A · 2027-01-04, 10:00–12:00")).toBeTruthy();
    expect(screen.getByText("The venue is unavailable that day.")).toBeTruthy();
    expect(screen.getByText(/the coordinator has been asked to arrange an alternative/)).toBeTruthy();
    expect(screen.queryByText("Listed below instead.")).toBeNull();
    expect(screen.queryByText("Not booked.")).toBeNull();
  });

  it("names the coordinator, and tolerates an event whose venue has left the catalogue", () => {
    problems = { "EVT-1": [{ text: "Deactivated." }] };
    app = fakeApp({ state: { role: "venue", events: [makeEvent({ venue: "V9", bookingState: "approved" })] } });
    render(<BookingsPage />);

    expect(screen.getByText(/^Design Keynote · +· 2027-01-04/)).toBeTruthy();
    expect(screen.getByText(/Priya Tan has been asked to arrange an alternative/)).toBeTruthy();
  });

  it("lists bookings requiring reassessment, confirmed and pending (US38)", () => {
    const flagged = { message: "The new setup time overlaps Gala.", clashes_with: [] };
    app = fakeApp({
      state: {
        role: "venue",
        events: [
          makeEvent({ id: "EVT-1", name: "Career Fair", bookings: [makeBooking({ id: 1, status: "approved", reassessment: flagged as never })] }),
          makeEvent({ id: "EVT-2", name: "Gala", coordinator: null, bookings: [makeBooking({ id: 2, venue_name: "Hall B", hold_start: "2027-01-05T09:00:00", reassessment: flagged as never })] }),
        ],
      },
    });
    render(<BookingsPage />);

    const confirmed = screen.getByLabelText("Requires reassessment: Career Fair at Hall A");
    expect(confirmed.textContent).toContain("Confirmed");
    expect(confirmed.textContent).toContain("The new setup time overlaps Gala.");
    expect(confirmed.textContent).toContain("conflict list");
    expect(confirmed.textContent).toContain("Priya Tan has been told to reassess it.");
    const pending = screen.getByLabelText("Requires reassessment: Gala at Hall B");
    expect(pending.textContent).toContain("Pending");
    expect(pending.textContent).toContain("the coordinator has been told to reassess it.");
  });

  it("lists expired holds, which never count as bookings (US42)", () => {
    app = fakeApp({
      state: {
        role: "venue",
        expiredHolds: [makeBooking({ id: 5, status: "expired", event_name: "Career Fair", hold_expires_at: "2027-01-02T10:00:00Z" } as never)],
      },
    });
    render(<BookingsPage />);

    expect(screen.getByText("Expired holds")).toBeTruthy();
    const card = screen.getByLabelText("Expired hold: Career Fair at Hall A");
    expect(card.textContent).toContain("Expired");
    expect(card.textContent).toContain("Hold expired");
    expect(card.textContent).toContain("the venue has been released");
  });
});
