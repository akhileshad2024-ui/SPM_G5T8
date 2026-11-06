// @vitest-environment jsdom
/** components/catalogue/VenueCard.tsx: one venue in Venue Staff's catalogue, with edit and (de)activate. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VenueCard } from "../../../components/catalogue/VenueCard";
import type { SaveVenueResult } from "../../../lib/state/app-context";
import type { UnavailabilityReason } from "../../../lib/types";
import { fakeApp } from "../../helpers/fake-app";
import { makeEvent, makeVenue } from "../../lib/venues/fixtures";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));

const ok = (flagged = 0): SaveVenueResult => ({ ok: true, venue: makeVenue(), flagged: Array.from({ length: flagged }, () => makeEvent()) });

const confirmedGala = makeEvent({ id: "E1", name: "Gala", date: "2027-01-04", venue: "V1", bookingState: "approved" });
const pendingMixer = makeEvent({ id: "E2", name: "Mixer", date: "2027-01-05", venue: "V1", bookingState: "pending" });
const elsewhere = makeEvent({ id: "E3", venue: "V2", bookingState: "approved" });
const cancelled = makeEvent({ id: "E4", venue: "V1", bookingState: "approved", status: "cancelled" });

function setup(events = [confirmedGala, pendingMixer, elsewhere, cancelled], overrides: Partial<Parameters<typeof fakeApp>[0]> = {}) {
  app = fakeApp({ state: { events }, setVenueActive: vi.fn().mockResolvedValue(ok()), saveVenue: vi.fn().mockResolvedValue(ok()), ...overrides });
}

beforeEach(() => setup());

describe("VenueCard", () => {
  it("shows the venue's details and its confirmed bookings", () => {
    render(
      <VenueCard
        venue={makeVenue({
          cap: 150, facilities: ["Stage"], accessibility: ["Wheelchair Access"], setupMinutes: 15, turnaroundMinutes: 30,
          unavailability: [
            { start: "2027-01-04T08:00", end: "2027-01-05T08:00", reason: "renovation", note: "Floor" },
            { start: "?", end: "?", reason: "flood" as UnavailabilityReason },
          ],
        })}
      />,
    );

    expect(screen.getByText("Hall A")).toBeTruthy();
    expect(screen.getByText("150")).toBeTruthy();
    expect(screen.getByText("Bookings").previousElementSibling?.textContent).toBe("1");
    expect(screen.getByText(/Mon, Tue, Wed, Thu, Fri/)).toBeTruthy();
    expect(screen.getByText("banquet")).toBeTruthy();
    expect(screen.getByText("Stage")).toBeTruthy();
    expect(screen.getByText("Wheelchair Access")).toBeTruthy();
    expect(screen.getByText("Renovation").parentElement?.textContent).toBe("Renovation · 04 Jan 2027, 08:00 – 05 Jan 2027, 08:00 · Floor");
    expect(screen.getByText("flood").parentElement?.textContent).toBe("flood");
    expect(screen.queryByText("Deactivated")).toBeNull();
    expect(screen.getByText("Deactivate")).toBeTruthy();
  });

  it("leaves out empty sections and says when hours aren't recorded", () => {
    render(<VenueCard venue={makeVenue({ facilities: [], accessibility: [], unavailability: [], operatingHours: null, operatingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] })} />);

    expect(screen.queryByText("Facilities")).toBeNull();
    expect(screen.queryByText("Accessibility")).toBeNull();
    expect(screen.queryByText("Unavailable")).toBeNull();
    expect(screen.getByText(/Not recorded · Every day/)).toBeTruthy();
  });

  it("lists the bookings that will be flagged before deactivating, and can back out", () => {
    render(<VenueCard venue={makeVenue()} />);

    fireEvent.click(screen.getByText("Deactivate"));

    expect(screen.getByText(/2 bookings at Hall A will be kept and flagged/)).toBeTruthy();
    expect(screen.getByText("Gala · 2027-01-04 (confirmed)")).toBeTruthy();
    expect(screen.getByText("Mixer · 2027-01-05 (pending)")).toBeTruthy();

    fireEvent.click(screen.getByText("Keep active"));
    expect(screen.queryByText("Deactivate venue")).toBeNull();
    expect(app.setVenueActive).not.toHaveBeenCalled();
  });

  it("words the warning for a single booking", () => {
    setup([pendingMixer]);
    render(<VenueCard venue={makeVenue()} />);
    fireEvent.click(screen.getByText("Deactivate"));
    expect(screen.getByText(/1 booking at Hall A will be kept/)).toBeTruthy();
  });

  it("deactivates a venue nobody has booked", async () => {
    setup([]);
    render(<VenueCard venue={makeVenue()} />);
    fireEvent.click(screen.getByText("Deactivate"));
    expect(screen.getByText("No current bookings use Hall A.")).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByText("Deactivate venue")); });

    expect(app.setVenueActive).toHaveBeenCalledWith("V1", false);
    expect(app.flash).toHaveBeenCalledWith("Hall A deactivated.", "ok");
  });

  it("warns how many bookings deactivating flagged", async () => {
    setup(undefined, { setVenueActive: vi.fn().mockResolvedValue(ok(2)) });
    render(<VenueCard venue={makeVenue()} />);
    fireEvent.click(screen.getByText("Deactivate"));

    await act(async () => { fireEvent.click(screen.getByText("Deactivate venue")); });

    expect(app.flash).toHaveBeenCalledWith("Hall A deactivated. 2 bookings flagged to coordinators.", "warn");
  });

  it("reactivates a deactivated venue and reports one flagged booking", async () => {
    setup(undefined, { setVenueActive: vi.fn().mockResolvedValue(ok(1)) });
    render(<VenueCard venue={makeVenue({ isActive: false })} />);
    expect(screen.getByText("Deactivated")).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByText("Reactivate")); });

    expect(app.setVenueActive).toHaveBeenCalledWith("V1", true);
    expect(app.flash).toHaveBeenCalledWith("Hall A reactivated. 1 booking flagged to coordinators.", "warn");
  });

  it("shows the error when the change fails", async () => {
    setup(undefined, { setVenueActive: vi.fn().mockResolvedValue({ ok: false, error: "Not allowed.", fields: {} }) });
    render(<VenueCard venue={makeVenue({ isActive: false })} />);

    await act(async () => { fireEvent.click(screen.getByText("Reactivate")); });

    expect(app.flash).toHaveBeenCalledWith("Not allowed.", "bad");
  });

  it("opens the form to edit, and goes back on cancel", () => {
    render(<VenueCard venue={makeVenue()} />);

    fireEvent.click(screen.getByText("Edit"));
    expect(screen.getByText("Edit Venue")).toBeTruthy();

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Edit Venue")).toBeNull();
    expect(screen.getByText("Hall A")).toBeTruthy();
  });

  it("closes the form and reports the update once it is saved", async () => {
    render(<VenueCard venue={makeVenue()} />);
    fireEvent.click(screen.getByText("Edit"));

    await act(async () => { fireEvent.click(screen.getByText("Save Venue")); });

    expect(app.saveVenue).toHaveBeenCalledWith("V1", expect.objectContaining({ name: "Hall A" }));
    expect(app.flash).toHaveBeenCalledWith("Hall A updated.", "ok");
    expect(screen.queryByText("Edit Venue")).toBeNull();
  });
});
