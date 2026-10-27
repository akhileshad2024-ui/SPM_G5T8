import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_PAGE,
  nextOlderPage,
  notificationFromApi,
  notificationTarget,
  savedId,
  withNewestPage,
  withOlderPage,
  type StoredNotification,
} from "../../lib/notifications";
import type { NotificationRecord } from "../../lib/types";

/**
 * US36 — Receive Notifications (page logic, unit). lib/notifications.ts: how the page keeps the
 * notifications GET /notifications sends, pages back to older ones, and where "Open event" goes.
 */

function stored(id: number, overrides: Partial<StoredNotification> = {}): StoredNotification {
  return { id, eventId: 7, eventName: "Design Keynote", title: `Notice ${id}`, body: `Design Keynote: ${id}.`,
    createdAt: "2027-01-02T10:00:00Z", read: false, ...overrides };
}

/** `count` stored notifications with ids from `newest` down. */
function page(newest: number, count: number): StoredNotification[] {
  return Array.from({ length: count }, (_, i) => stored(newest - i));
}

const pageOnly: NotificationRecord = { id: 0.5, to: "attendee", title: "Registration withdrawn", body: "You withdrew.", when: "now", read: false };

describe("US36 - the page's copy of a saved notification", () => {
  it("[US36-AC2] keeps the event it is about and what it says", () => {
    expect(notificationFromApi(stored(12, { read: true }), "coordinator")).toMatchObject({
      id: -12, to: "coordinator", eventId: 7, eventName: "Design Keynote", title: "Notice 12", body: "Design Keynote: 12.", read: true,
    });
  });

  it("saved notifications get negative ids, so they never clash with page-only ones", () => {
    expect(savedId({ id: -12 })).toBe(12);
    expect(savedId(pageOnly)).toBeNull();
  });
});

describe("US36 - the regular poll (newest page)", () => {
  it("[US36-AC5] new notifications appear and read state follows the server", () => {
    const before = withNewestPage({ notifs: [], olderNotifs: false }, [stored(1)], "coordinator");
    const after = withNewestPage(before, [stored(2), stored(1, { read: true })], "coordinator");
    expect(after.notifs.map((n) => [n.id, n.read])).toEqual([[-2, false], [-1, true]]);
  });

  it("keeps page-only notices after the saved ones", () => {
    const inbox = withNewestPage({ notifs: [pageOnly], olderNotifs: false }, [stored(3)], "attendee");
    expect(inbox.notifs.map((n) => n.id)).toEqual([-3, 0.5]);
  });

  it("[US36-AC3] a full page means there may be older ones", () => {
    expect(withNewestPage({ notifs: [], olderNotifs: false }, page(300, NOTIFICATION_PAGE), "organiser").olderNotifs).toBe(true);
    expect(withNewestPage({ notifs: [], olderNotifs: false }, page(5, 5), "organiser").olderNotifs).toBe(false);
  });

  it("[US36-AC3] keeps an older page the user loaded, with nothing lost or repeated", () => {
    // Loaded: the newest page (400..201) and one older page (200..1). Then notification 401 arrives.
    const loaded = withOlderPage(withNewestPage({ notifs: [], olderNotifs: false }, page(400, NOTIFICATION_PAGE), "organiser"),
      page(200, NOTIFICATION_PAGE), "organiser");
    const polled = withNewestPage(loaded, page(401, NOTIFICATION_PAGE), "organiser");
    expect(polled.notifs.map((n) => savedId(n))).toEqual(Array.from({ length: 401 }, (_, i) => 401 - i));
    expect(polled.olderNotifs).toBe(true);
  });
});

describe("US36 - Show older", () => {
  it("[US36-AC3] asks for the notifications before the oldest one loaded", () => {
    expect(nextOlderPage([notificationFromApi(stored(9), "lead"), notificationFromApi(stored(4), "lead"), pageOnly])).toBe(4);
  });

  it("has nothing to ask for when no saved notification is loaded", () => {
    expect(nextOlderPage([pageOnly])).toBeNull();
    expect(nextOlderPage([])).toBeNull();
  });

  it("[US36-AC3] adds the older page after the saved ones and before page-only notices", () => {
    const current = { notifs: [notificationFromApi(stored(9), "lead"), pageOnly], olderNotifs: true };
    const inbox = withOlderPage(current, [stored(4), stored(3)], "lead");
    expect(inbox.notifs.map((n) => n.id)).toEqual([-9, -4, -3, 0.5]);
    expect(inbox.olderNotifs).toBe(false);
  });
});

describe("US36 - Open event", () => {
  const events = [{ id: "EVT-1", backendId: 7 }, { id: "EVT-2", backendId: 8 }];

  it("takes the organiser to the event's own page", () => {
    expect(notificationTarget({ eventId: 7 }, "organiser", events)).toEqual({ route: "/my-events/7" });
  });

  it("selects the event in the coordinator's queue", () => {
    expect(notificationTarget({ eventId: 8 }, "coordinator", events)).toEqual({ route: "/queue", select: "EVT-2" });
  });

  it("takes a coordinator to their queue when the event is no longer theirs", () => {
    expect(notificationTarget({ eventId: 99 }, "coordinator", events)).toEqual({ route: "/queue" });
  });

  it.each([
    ["venue", "/bookings"],
    ["tech", "/equipment"],
    ["attendee", "/browse"],
    ["lead", "/assignments"],
  ] as const)("takes %s staff to the page they work on events from", (role, route) => {
    expect(notificationTarget({ eventId: 7 }, role, events)).toEqual({ route });
  });

  it("does nothing for a notice that isn't about a saved event", () => {
    expect(notificationTarget({}, "organiser", events)).toBeNull();
  });
});
