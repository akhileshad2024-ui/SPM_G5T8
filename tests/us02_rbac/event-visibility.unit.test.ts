/**
 * US02 — "can view only the events they are associated with or authorised to see".
 *
 * Unit tests for the per-role event lists in lib/event-visibility.ts, using the seed data.
 */
import { describe, expect, it } from "vitest";
import { seedEvents } from "../../lib/data";
import { organiserEvents, publishedEvents, reviewQueue } from "../../lib/event-visibility";
import type { EventRecord } from "../../lib/types";

const events = seedEvents();
const ids = (list: EventRecord[]) => list.map((e) => e.id).sort();
const byId = (id: string) => events.find((e) => e.id === id)!;

describe("organiser: My events", () => {
  it("lists only the events the organiser organises", () => {
    expect(ids(organiserEvents(events, "Maya Rahman"))).toEqual(["EVT-2030", "EVT-2041", "EVT-2050"]);
  });

  it("includes the organiser's own drafts", () => {
    expect(organiserEvents(events, "Maya Rahman").some((e) => e.status === "draft")).toBe(true);
  });

  it("never includes another organiser's events", () => {
    expect(organiserEvents(events, "Maya Rahman").every((e) => e.organiser === "Maya Rahman")).toBe(true);
  });

  it("is empty for someone who organises nothing", () => {
    expect(organiserEvents(events, "Sam Adeyemi")).toEqual([]);
  });
});

describe("attendee: Browse events", () => {
  it("lists only published events open for registration", () => {
    expect(ids(publishedEvents(events))).toEqual(["EVT-2012", "EVT-2028", "EVT-2030", "EVT-2035"]);
  });

  it.each(["draft", "submitted", "under_review", "pending_clarification", "approved", "rejected", "cancelled", "completed"] as const)(
    "hides events that are %s",
    (status) => {
      const e = { ...byId("EVT-2030"), status };
      expect(publishedEvents([e])).toEqual([]);
    },
  );

  it("hides published events without registration", () => {
    const e = { ...byId("EVT-2030"), reg: false };
    expect(publishedEvents([e])).toEqual([]);
  });

  it("never shows another organiser's private draft (Postgrad Mixer)", () => {
    expect(publishedEvents(events).map((e) => e.name)).not.toContain("Postgrad Mixer");
  });
});

describe("coordinator: Review queue", () => {
  it("'All' lists every request except drafts", () => {
    const list = reviewQueue(events, "all", "Priya Tan");
    expect(list.some((e) => e.status === "draft")).toBe(false);
    expect(list).toHaveLength(events.filter((e) => e.status !== "draft").length);
  });

  it("'Needs action' lists only submitted or under-review requests", () => {
    const list = reviewQueue(events, "action", "Priya Tan");
    expect(ids(list)).toEqual(["EVT-2041", "EVT-2044", "EVT-2045"]);
  });

  it("'Mine' lists only requests assigned to this coordinator", () => {
    const list = reviewQueue(events, "mine", "Priya Tan");
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((e) => e.coordinator === "Priya Tan")).toBe(true);
  });

  it("'Mine' is empty for a coordinator with no assignments", () => {
    expect(reviewQueue(events, "mine", "Someone Else")).toEqual([]);
  });

  it("searches by event name or organiser, ignoring case and spaces", () => {
    expect(ids(reviewQueue(events, "all", "Priya Tan", "  ALUMNI "))).toEqual(["EVT-2041"]);
    expect(ids(reviewQueue(events, "all", "Priya Tan", "jihoon"))).toEqual(["EVT-2028", "EVT-2035"]);
  });

  it("never reveals a draft, even when searched for by name", () => {
    expect(reviewQueue(events, "all", "Priya Tan", "Postgrad Mixer")).toEqual([]);
  });
});
