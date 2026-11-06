// @vitest-environment jsdom
/** components/venues/VenueDetails.tsx: the read-only view of one catalogue venue. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VenueDetails } from "../../../components/venues/VenueDetails";
import type { UnavailabilityReason } from "../../../lib/types";
import { makeVenue } from "../../lib/venues/fixtures";

describe("VenueDetails", () => {
  it("shows everything recorded about the venue", () => {
    render(
      <VenueDetails
        venue={makeVenue({
          name: "Hall A", location: "Block A", cap: 200, layouts: ["banquet"], facilities: ["Stage"], accessibility: ["Wheelchair Access"],
          setupMinutes: 15, turnaroundMinutes: 30,
          unavailability: [
            { start: "2027-01-04T08:00", end: "2027-01-05T08:00", reason: "maintenance", note: "Repainting" },
            { start: "not set", end: "2027-01-05T08:00", reason: "flood" as UnavailabilityReason },
          ],
        })}
      />,
    );

    expect(screen.getByLabelText("Details of Hall A")).toBeTruthy();
    expect(screen.getByText("200")).toBeTruthy();
    expect(screen.getByText("Banquet")).toBeTruthy();
    expect(screen.getByText("Stage")).toBeTruthy();
    expect(screen.getByText("Wheelchair Access")).toBeTruthy();
    expect(screen.getByText("08:00 - 22:00")).toBeTruthy();
    expect(screen.getByText("Monday, Tuesday, Wednesday, Thursday, Friday")).toBeTruthy();
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getByText("Maintenance").parentElement?.textContent).toBe("Maintenance · 04 Jan 2027, 08:00 – 05 Jan 2027, 08:00 · Repainting");
    expect(screen.getByText("flood").parentElement?.textContent).toBe("flood");
    expect(screen.getByText(/Last updated by Venue Staff/)).toBeTruthy();
  });

  it("says what isn't recorded and hides an empty unavailability list", () => {
    render(<VenueDetails venue={makeVenue({ layouts: [], facilities: [], accessibility: [], operatingHours: null, operatingDays: [] })} />);

    expect(screen.getAllByText("None recorded")).toHaveLength(3);
    expect(screen.getAllByText("Not recorded")).toHaveLength(2);
    expect(screen.queryByText("Unavailable")).toBeNull();
  });
});
