// @vitest-environment jsdom
/**
 * components/board/BoardColumn.tsx: one column of the pipeline board. Each card shows the venue,
 * equipment and registration state, and opens the event in the review queue.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardColumn } from "../../../components/board/BoardColumn";
import { fakeApp } from "../../helpers/fake-app";
import { makeEvent } from "../../pages/fixtures";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));

beforeEach(() => {
  app = fakeApp();
});

describe("BoardColumn", () => {
  it("says Empty when there are no cards", () => {
    render(<BoardColumn label="Submitted" color="#1466FF" cards={[]} />);

    expect(screen.getByText("Submitted")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("Empty")).toBeTruthy();
  });

  it.each([
    ["approved", "reserved", "venue booked", "equipment reserved"],
    ["pending", "requested", "venue pending", "equipment pending"],
    [null, null, "no venue", "no equipment"],
  ] as const)("shows booking %s and equipment %s", (bookingState, equipState, venueChip, equipChip) => {
    render(<BoardColumn label="Approved" color="#00C2A8" cards={[makeEvent({ bookingState, equipState })]} />);

    expect(screen.getByText(venueChip)).toBeTruthy();
    expect(screen.getByText(equipChip)).toBeTruthy();
    expect(screen.queryByText(/registered$/)).toBeNull();
    expect(screen.queryByText("Empty")).toBeNull();
  });

  it("shows registrations and opens the event in the queue", () => {
    render(<BoardColumn label="Confirmed" color="#0A0E1A" cards={[makeEvent({ reg: true, registered: 12, regCap: 80 })]} />);

    expect(screen.getByText("12/80 registered")).toBeTruthy();
    expect(screen.getByText(/2027-01-04/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(app.selectAndGoToQueue).toHaveBeenCalledWith("EVT-1");
  });
});
