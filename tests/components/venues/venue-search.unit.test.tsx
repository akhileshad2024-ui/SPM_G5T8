// @vitest-environment jsdom
/** components/venues/VenueSearch.tsx: the coordinator's venue search and filter chips (US20). */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VenueSearch } from "../../../components/venues/VenueSearch";
import type { VenueSearchResponse } from "../../../lib/types";
import { fakeApp } from "../../helpers/fake-app";
import { makeApiVenue, makeVenue } from "../../lib/venues/fixtures";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

function response(overrides: Partial<VenueSearchResponse> = {}): VenueSearchResponse {
  return { venues: [makeApiVenue({ id: 7, name: "Hall B" })], total: 1, applied_filters: [], message: null, ...overrides };
}

/** A promise the test resolves or rejects when it chooses. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const search = () => fireEvent.click(screen.getByText("Search"));
const lastBody = () => JSON.parse(apiFetch.mock.calls.at(-1)![1].body);

beforeEach(() => {
  apiFetch.mockReset();
  app = fakeApp({
    state: {
      venues: [
        makeVenue({ id: "1", location: " Block B " }),
        makeVenue({ id: "2", location: "Block A" }),
        makeVenue({ id: "3", location: "Block A" }),
        makeVenue({ id: "4", location: "Closed Wing", isActive: false }),
      ],
    },
  });
});

describe("VenueSearch", () => {
  it("offers only the locations active venues have, once each and sorted", () => {
    render(<VenueSearch onResults={vi.fn()} />);

    const options = Array.from(screen.getByDisplayValue("Any location").querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["Any location", "Block A", "Block B"]);
  });

  it("searches with the filters chosen and reports the venues found", async () => {
    apiFetch.mockResolvedValue(response());
    const onResults = vi.fn();
    const { container } = render(<VenueSearch onResults={onResults} />);

    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: "2027-01-04" } });
    const [start, end] = container.querySelectorAll('input[type="time"]');
    fireEvent.change(start, { target: { value: "10:00" } });
    fireEvent.change(end, { target: { value: "12:00" } });
    fireEvent.change(container.querySelector('input[type="number"]')!, { target: { value: "50" } });
    fireEvent.change(screen.getByDisplayValue("Any location"), { target: { value: "Block A" } });
    fireEvent.change(screen.getByDisplayValue("Any layout"), { target: { value: "theatre" } });
    fireEvent.click(screen.getByLabelText("Wheelchair Access"));
    fireEvent.click(screen.getByLabelText("Stage"));
    fireEvent.click(screen.getByLabelText("Projector"));
    fireEvent.click(screen.getByLabelText("Projector")); // and untick it again
    search();

    expect(screen.getByText("Searching…")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("1 venue found")).toBeTruthy());
    expect(apiFetch).toHaveBeenCalledWith("/venues/search", expect.objectContaining({ method: "POST" }));
    expect(lastBody()).toEqual({
      date: "2027-01-04", start: "10:00", end: "12:00", attendance: 50, location: "Block A", layout: "theatre",
      accessibility: ["Wheelchair Access"], facilities: ["Stage"],
    });
    expect(onResults).toHaveBeenCalledWith([expect.objectContaining({ id: "7", name: "Hall B" })]);
    expect(screen.getByText("Search")).toBeTruthy();
  });

  it("says how many venues were found, in the plural", async () => {
    apiFetch.mockResolvedValue(response({ total: 3 }));
    render(<VenueSearch onResults={vi.fn()} />);
    search();
    expect(await screen.findByText("3 venues found")).toBeTruthy();
  });

  it("shows the server's message instead of the count when it sends one", async () => {
    apiFetch.mockResolvedValue(response({ venues: [], total: 0, message: "No venues match these filters." }));
    render(<VenueSearch onResults={vi.fn()} />);
    search();
    expect(await screen.findByText("No venues match these filters.")).toBeTruthy();
    expect(screen.queryByText(/found/)).toBeNull();
  });

  it("won't search filters that don't make sense, and says why", () => {
    const { container } = render(<VenueSearch onResults={vi.fn()} />);

    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: "2027-01-04" } });
    search();

    expect(screen.getByRole("alert").textContent).toBe("Give the date, start time and end time together.");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("clears one applied filter and searches again without it", async () => {
    apiFetch.mockResolvedValueOnce(response({ applied_filters: [{ key: "layout", label: "Layout", value: "Theatre" }] }));
    apiFetch.mockResolvedValueOnce(response({ total: 2 }));
    render(<VenueSearch onResults={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue("Any layout"), { target: { value: "theatre" } });
    search();
    expect(await screen.findByText("Filters applied")).toBeTruthy();
    expect(screen.getByText(/Layout: Theatre/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Clear Layout filter"));

    expect(await screen.findByText("2 venues found")).toBeTruthy();
    expect(lastBody().layout).toBeUndefined();
    expect(screen.queryByText("Filters applied")).toBeNull();
  });

  it("clears everything and tells the page there are no results", async () => {
    apiFetch.mockResolvedValue(response());
    const onResults = vi.fn();
    render(<VenueSearch onResults={onResults} />);
    fireEvent.change(screen.getByDisplayValue("Any layout"), { target: { value: "theatre" } });
    search();
    await screen.findByText("1 venue found");

    fireEvent.click(screen.getByText("Clear all"));

    expect(onResults).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText("1 venue found")).toBeNull();
    expect(screen.getByDisplayValue("Any layout")).toBeTruthy();
  });

  it("hands a failed search to the app's error handler", async () => {
    const error = new Error("offline");
    apiFetch.mockRejectedValue(error);
    const onResults = vi.fn();
    render(<VenueSearch onResults={onResults} />);

    search();

    await waitFor(() => expect(app.handleApiError).toHaveBeenCalledWith(error));
    expect(onResults).not.toHaveBeenCalled();
    expect(screen.getByText("Search")).toBeTruthy();
  });

  it("ignores an older search's answer once a newer search has started", async () => {
    const first = deferred<VenueSearchResponse>();
    const second = deferred<VenueSearchResponse>();
    apiFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onResults = vi.fn();
    render(<VenueSearch onResults={onResults} />);
    const form = screen.getByRole("form", { name: "Search venues" });

    fireEvent.submit(form);
    fireEvent.submit(form);
    await act(async () => first.resolve(response({ total: 9 })));
    expect(onResults).not.toHaveBeenCalled();
    expect(screen.getByText("Searching…")).toBeTruthy();

    await act(async () => second.resolve(response({ total: 2 })));
    expect(screen.getByText("2 venues found")).toBeTruthy();
    expect(onResults).toHaveBeenCalledTimes(1);
  });

  it("ignores an older search's failure once a newer search has started", async () => {
    const first = deferred<VenueSearchResponse>();
    const second = deferred<VenueSearchResponse>();
    apiFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<VenueSearch onResults={vi.fn()} />);
    const form = screen.getByRole("form", { name: "Search venues" });

    fireEvent.submit(form);
    fireEvent.submit(form);
    await act(async () => first.reject(new Error("late")));
    expect(app.handleApiError).not.toHaveBeenCalled();
    expect(screen.getByText("Searching…")).toBeTruthy();

    await act(async () => second.resolve(response()));
    expect(screen.getByText("1 venue found")).toBeTruthy();
  });
});
