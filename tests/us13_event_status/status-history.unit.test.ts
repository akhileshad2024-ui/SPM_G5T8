/**
 * US13 — View Event Status: unit tests for lib/events/status-history.ts, the helpers
 * behind the status history timeline (how each status and change is worded, when it
 * happened, the order shown, and loading it from GET /events/{id}/history).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api/client";
import {
  describeChange,
  fetchStatusHistory,
  formatChangedAt,
  newestFirst,
  statusLabel,
  type StatusChange,
} from "../../lib/events/status-history";
import type { EventStatus } from "../../lib/types";

function change(fromStatus: EventStatus | null, toStatus: EventStatus, changedAt = "2026-10-08T06:05:00Z"): StatusChange {
  return { fromStatus, toStatus, changedBy: "Priya Tan", changedAt, reason: null };
}

describe("statusLabel (AC2: the defined status set)", () => {
  it.each<[EventStatus, string]>([
    ["draft", "Draft"],
    ["submitted", "Submitted"],
    ["under_review", "Under Review"],
    ["pending_clarification", "Pending Clarification"],
    ["approved", "Approved"],
    ["rejected", "Rejected"],
    ["confirmed", "Confirmed"],
    ["cancelled", "Cancelled"],
  ])("names %s as %s", (status, label) => {
    expect(statusLabel(status)).toBe(label);
  });

  it("falls back to the raw value for a status it doesn't know, rather than showing nothing", () => {
    expect(statusLabel("planning" as EventStatus)).toBe("planning");
  });
});

describe("describeChange (AC3: what each history entry says)", () => {
  it("describes the first entry as how the event was created", () => {
    expect(describeChange(change(null, "draft"))).toBe("Created as Draft");
    expect(describeChange(change(null, "submitted"))).toBe("Created as Submitted");
  });

  it("describes later entries as from -> to, using the status names", () => {
    expect(describeChange(change("submitted", "under_review"))).toBe("Submitted → Under Review");
    expect(describeChange(change("under_review", "pending_clarification"))).toBe("Under Review → Pending Clarification");
  });
});

describe("formatChangedAt (AC3: timestamped)", () => {
  it("shows the date and 24-hour time in the given time zone", () => {
    expect(formatChangedAt("2026-10-08T06:05:00Z", "Asia/Singapore")).toBe("08 Oct 2026, 14:05");
    expect(formatChangedAt("2026-10-08T06:05:00Z", "UTC")).toBe("08 Oct 2026, 06:05");
  });

  it("moves to the next day when the time zone crosses midnight", () => {
    expect(formatChangedAt("2026-10-08T20:30:00+00:00", "Asia/Singapore")).toBe("09 Oct 2026, 04:30");
  });

  it("uses the viewer's own time zone when none is given", () => {
    const iso = "2026-10-08T06:05:00Z";
    const local = new Date(iso).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    expect(formatChangedAt(iso)).toBe(local);
  });
});

describe("newestFirst (the order the timeline shows)", () => {
  const oldestFirst = [change(null, "submitted"), change("submitted", "under_review"), change("under_review", "approved")];

  it("puts the latest change first", () => {
    expect(newestFirst(oldestFirst).map((c) => c.toStatus)).toEqual(["approved", "under_review", "submitted"]);
  });

  it("leaves the list it was given unchanged", () => {
    const copy = [...oldestFirst];
    newestFirst(oldestFirst);
    expect(oldestFirst).toEqual(copy);
  });

  it("handles an empty history", () => {
    expect(newestFirst([])).toEqual([]);
  });
});

describe("fetchStatusHistory (loading it from the backend)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks GET /api/events/{id}/history and returns the entries", async () => {
    const entries = [change(null, "submitted")];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(entries), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchStatusHistory(42)).resolves.toEqual(entries);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/events/42/history");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "same-origin" });
  });

  it("fails with a 403 ApiError when the user isn't involved in the event (AC4)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "You don't have permission to do that" }), { status: 403 }),
    ));

    const error = await fetchStatusHistory(42).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, message: "You don't have permission to do that" });
  });

  it("fails with a 404 ApiError for an event that doesn't exist", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Event not found" }), { status: 404 }),
    ));

    await expect(fetchStatusHistory(999)).rejects.toMatchObject({ status: 404, message: "Event not found" });
  });
});
