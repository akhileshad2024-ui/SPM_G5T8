// @vitest-environment jsdom
/**
 * components/browse/PublicEventCard.tsx: one published event on Browse. Register, join the waitlist when
 * full, or withdraw (after confirming) when already registered.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicEventCard } from "../../../components/browse/PublicEventCard";
import { fakeApp } from "../../helpers/fake-app";
import { makeEvent, makeRegistration } from "../../pages/fixtures";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));
// Owned by another chunk; stubbed so this test is only about the card.
vi.mock("@/components/ui/EventDetails", () => ({ EventDetailsToggle: () => <div>details toggle</div> }));
vi.mock("@/components/ui/StatusHistory", () => ({ StatusHistoryToggle: () => <div>history toggle</div> }));

const event = makeEvent({ status: "confirmed", reg: true, regCap: 100, registered: 40, venueName: "Hall A" });

beforeEach(() => {
  app = fakeApp({ state: { role: "attendee" } });
});

describe("PublicEventCard", () => {
  it("offers registration when there are places, with the venue name from the event", () => {
    render(<PublicEventCard event={event} />);

    expect(screen.getByText("Design Keynote")).toBeTruthy();
    expect(screen.getByText("2027-01-04 · 10:00–12:00")).toBeTruthy();
    expect(screen.getByText("Hall A")).toBeTruthy();
    expect(screen.getByText("40 of 100 places taken")).toBeTruthy();
    expect(screen.getByText("details toggle")).toBeTruthy();
    expect(screen.getByText("history toggle")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(app.registerForEvent).toHaveBeenCalledWith("EVT-1");
  });

  it("uses the catalogue venue's name and location when the event has a venue", () => {
    app = fakeApp({
      state: { role: "attendee" },
      venue: (id?: string | null) => (id === "V1" ? ({ id: "V1", name: "Lecture Theatre 1", location: "Block B" } as never) : undefined),
    });
    render(<PublicEventCard event={{ ...event, venue: "V1" }} />);

    expect(screen.getByText("Lecture Theatre 1 · Block B")).toBeTruthy();
  });

  it("says the venue is still to be confirmed when there is none", () => {
    render(<PublicEventCard event={{ ...event, venueName: null }} />);
    expect(screen.getByText("Venue to be confirmed")).toBeTruthy();
  });

  it("offers the waitlist once the event is full", () => {
    render(<PublicEventCard event={{ ...event, registered: 100 }} />);

    expect(screen.getByText("100 of 100 places taken · full")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Join waitlist" }));
    expect(app.registerForEvent).toHaveBeenCalledWith("EVT-1");
  });

  it("treats an event with no place limit as never full", () => {
    render(<PublicEventCard event={{ ...event, regCap: 0, registered: 0 }} />);
    expect(screen.getByText("0 of 0 places taken")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Register" })).toBeTruthy();
  });

  it("withdraws only after you confirm, and keeps the registration if you change your mind", () => {
    app = fakeApp({ state: { role: "attendee", registrations: [makeRegistration()] } });
    render(<PublicEventCard event={event} />);
    expect(screen.getByText("registered")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(screen.getByText("Withdraw your registration for Design Keynote?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep registration" }));
    expect(screen.queryByText("Withdraw your registration for Design Keynote?")).toBeNull();
    expect(app.withdrawRegistration).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    expect(app.withdrawRegistration).toHaveBeenCalledWith("EVT-1");
    expect(screen.queryByText("Withdraw your registration for Design Keynote?")).toBeNull();
    expect(app.registerForEvent).not.toHaveBeenCalled();
  });

  it("shows a waitlisted registration", () => {
    app = fakeApp({ state: { role: "attendee", registrations: [makeRegistration({ status: "waitlisted" })] } });
    render(<PublicEventCard event={event} />);
    expect(screen.getByText("waitlisted")).toBeTruthy();
  });

  it("ignores a withdrawn registration, someone else's, and one for another event", () => {
    app = fakeApp({
      state: {
        role: "attendee",
        registrations: [
          makeRegistration({ id: "R-1", status: "withdrawn" }),
          makeRegistration({ id: "R-2", attendeeEmail: "someone@else.edu" }),
          makeRegistration({ id: "R-3", eventId: "EVT-2" }),
        ],
      },
    });
    render(<PublicEventCard event={event} />);
    expect(screen.getByRole("button", { name: "Register" })).toBeTruthy();
  });
});
