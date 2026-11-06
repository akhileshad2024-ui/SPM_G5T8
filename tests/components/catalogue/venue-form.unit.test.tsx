// @vitest-environment jsdom
/** components/catalogue/VenueForm.tsx: Venue Staff add or edit a catalogue venue (US17, Week 7 changes). */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VenueForm } from "../../../components/catalogue/VenueForm";
import type { SaveVenueResult } from "../../../lib/state/app-context";
import { fakeApp } from "../../helpers/fake-app";
import { makeVenue } from "../../lib/venues/fixtures";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));

const saved: SaveVenueResult = { ok: true, venue: makeVenue(), flagged: [] };

beforeEach(() => {
  app = fakeApp({ saveVenue: vi.fn().mockResolvedValue(saved) });
});

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => act(async () => { fireEvent.click(screen.getByText("Save Venue")); });

function fillRequired() {
  type("Venue name", " Hall Z ");
  type("Location", "Block Z");
  type("Capacity", "120");
}

describe("VenueForm", () => {
  it("adds a new venue with what was entered", async () => {
    const onSuccess = vi.fn();
    render(<VenueForm onSuccess={onSuccess} onCancel={vi.fn()} />);
    expect(screen.getByText("Add Venue")).toBeTruthy();

    fillRequired();
    fireEvent.click(screen.getByLabelText("Theatre"));
    fireEvent.click(screen.getByLabelText("Stage"));
    fireEvent.click(screen.getByLabelText("Wheelchair Access"));
    fireEvent.click(screen.getByLabelText("Saturday"));
    fireEvent.click(screen.getByLabelText("Monday")); // untick a default day
    type("Opening time", "09:00");
    type("Closing time", "18:00");
    type("Setup minutes", "15");
    type("Turnaround minutes", "30");
    await save();

    expect(app.saveVenue).toHaveBeenCalledWith(null, {
      name: "Hall Z", location: "Block Z", cap: 120, layouts: ["theatre"], facilities: ["Stage"], accessibility: ["Wheelchair Access"],
      operatingHours: "09:00 - 18:00", operatingDays: ["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      setupMinutes: 15, turnaroundMinutes: 30, unavailability: [],
    });
    expect(onSuccess).toHaveBeenCalledWith(saved);
  });

  it("shows 'Saving…' while the save is in flight", async () => {
    let finish!: (r: SaveVenueResult) => void;
    app = fakeApp({ saveVenue: vi.fn(() => new Promise<SaveVenueResult>((r) => { finish = r; })) });
    render(<VenueForm onSuccess={vi.fn()} onCancel={vi.fn()} />);
    fillRequired();

    await save();
    expect((screen.getByText("Saving…") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => finish(saved));
    expect(screen.getByText("Save Venue")).toBeTruthy();
  });

  it("edits an existing venue, keeping an older accessibility value it can untick", async () => {
    render(
      <VenueForm
        initialData={makeVenue({ id: "V9", accessibility: ["Wheelchair Access", "Lift"] })}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Edit Venue")).toBeTruthy();
    expect((screen.getByLabelText("Venue name") as HTMLInputElement).value).toBe("Hall A");

    fireEvent.click(screen.getByLabelText("Lift"));
    await save();

    expect(app.saveVenue).toHaveBeenCalledWith("V9", expect.objectContaining({ accessibility: ["Wheelchair Access"] }));
  });

  it("won't save a form with problems: flags them and shows each by its field", async () => {
    render(<VenueForm onSuccess={vi.fn()} onCancel={vi.fn()} />);

    await save();

    expect(app.flash).toHaveBeenCalledWith("Fix the highlighted fields before saving.", "warn");
    expect(app.saveVenue).not.toHaveBeenCalled();
    expect(screen.getByText("Enter the venue name.")).toBeTruthy();
    expect(screen.getByText("Enter where the venue is.")).toBeTruthy();
    expect(screen.getByText("Capacity must be a whole number greater than 0.")).toBeTruthy();
  });

  it("adds, edits and removes unavailable periods", async () => {
    render(<VenueForm onSuccess={vi.fn()} onCancel={vi.fn()} />);
    fillRequired();

    fireEvent.click(screen.getByText("+ Add unavailable period"));
    fireEvent.click(screen.getByText("+ Add unavailable period"));
    expect(screen.getAllByLabelText("Reason")).toHaveLength(2);
    expect(screen.getAllByPlaceholderText("Note (optional)")).toHaveLength(2);

    fireEvent.change(screen.getAllByLabelText("Unavailable from")[0], { target: { value: "2027-01-04T08:00" } });
    fireEvent.change(screen.getAllByLabelText("Unavailable until")[0], { target: { value: "2027-01-05T08:00" } });
    fireEvent.change(screen.getAllByLabelText("Reason")[0], { target: { value: "other" } });
    expect(screen.getByPlaceholderText("Note (required)")).toBeTruthy();
    fireEvent.change(screen.getAllByLabelText("Note")[0], { target: { value: "Exams" } });
    fireEvent.click(screen.getAllByText("Remove")[1]);
    expect(screen.getAllByLabelText("Reason")).toHaveLength(1);

    await save();

    expect(app.saveVenue).toHaveBeenCalledWith(null, expect.objectContaining({
      unavailability: [{ start: "2027-01-04T08:00", end: "2027-01-05T08:00", reason: "other", note: "Exams" }],
    }));
  });

  it("shows a period's problem under that period", async () => {
    render(<VenueForm onSuccess={vi.fn()} onCancel={vi.fn()} />);
    fillRequired();
    fireEvent.click(screen.getByText("+ Add unavailable period"));

    await save();

    expect(screen.getByText("Enter a start and an end.")).toBeTruthy();
  });

  it("shows the server's field errors, nested keys included", async () => {
    app = fakeApp({
      saveVenue: vi.fn().mockResolvedValue({ ok: false, error: "Invalid", fields: { name: "Name taken.", "unavailability.0.end": "Too far ahead." } }),
    });
    render(<VenueForm initialData={makeVenue({ unavailability: [{ start: "2027-01-04T08:00", end: "2027-01-05T08:00", reason: "maintenance" }] })} onSuccess={vi.fn()} onCancel={vi.fn()} />);

    await save();

    expect(screen.getByText("Name taken.")).toBeTruthy();
    expect(screen.getByText("Too far ahead.")).toBeTruthy();
    expect(screen.queryByText("Invalid")).toBeNull();
  });

  it("shows the server's general error when no field is to blame", async () => {
    const onSuccess = vi.fn();
    app = fakeApp({ saveVenue: vi.fn().mockResolvedValue({ ok: false, error: "Server unavailable.", fields: {} }) });
    render(<VenueForm initialData={makeVenue()} onSuccess={onSuccess} onCancel={vi.fn()} />);

    await save();

    expect(screen.getByText("Server unavailable.")).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("cancels", () => {
    const onCancel = vi.fn();
    render(<VenueForm onSuccess={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
