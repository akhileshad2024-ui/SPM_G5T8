import { DEFAULT_ROUTE } from "./auth/route-access";
import type { EventRecord, NotificationRecord, Role } from "./types";

/**
 * US36 — Receive Notifications, on the page. The server saves each notification for the person involved
 * (backend/messaging.py); the page polls GET /notifications, keeps older pages the user asked for, and opens
 * the event a notification is about.
 */

/** How many notifications GET /notifications returns at a time (messaging.PAGE_SIZE). */
export const NOTIFICATION_PAGE = 200;

/** A notification as GET /notifications sends it. */
export interface StoredNotification {
  id: number;
  eventId: number;
  eventName: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

/** A saved notification as the page keeps it: negative ids, so they never clash with page-only ones. */
export function notificationFromApi(row: StoredNotification, role: Role): NotificationRecord {
  return { id: -row.id, to: role, title: row.title, body: row.body, eventId: row.eventId, eventName: row.eventName,
    when: new Date(row.createdAt).toLocaleString(), read: row.read };
}

/** The server id of a notification the page holds, or null for a page-only one. */
export function savedId(n: Pick<NotificationRecord, "id">): number | null {
  return n.id < 0 ? -n.id : null;
}

interface Inbox {
  notifs: NotificationRecord[];
  /** The server may have older notifications than the ones loaded. */
  olderNotifs: boolean;
}

/**
 * The regular poll brought the newest page. It replaces the newest saved notifications (their read state
 * may have changed), keeps older pages the user already loaded, and keeps page-only notices.
 */
export function withNewestPage(current: Inbox, rows: StoredNotification[], role: Role): Inbox {
  const oldestFresh = rows.length ? Math.min(...rows.map((row) => row.id)) : Infinity;
  const older = current.notifs.filter((n) => (savedId(n) ?? Infinity) < oldestFresh);
  return {
    notifs: [...rows.map((row) => notificationFromApi(row, role)), ...older, ...current.notifs.filter((n) => savedId(n) === null)],
    olderNotifs: older.length ? current.olderNotifs : rows.length === NOTIFICATION_PAGE,
  };
}

/** The `before` id for the next older page: the oldest saved notification loaded, or null when there is none. */
export function nextOlderPage(notifs: NotificationRecord[]): number | null {
  const ids = notifs.map(savedId).filter((id): id is number => id !== null);
  return ids.length ? Math.min(...ids) : null;
}

/** An older page arrived: it goes after the saved notifications already loaded, before page-only ones. */
export function withOlderPage(current: Inbox, rows: StoredNotification[], role: Role): Inbox {
  return {
    notifs: [...current.notifs.filter((n) => savedId(n) !== null), ...rows.map((row) => notificationFromApi(row, role)),
      ...current.notifs.filter((n) => savedId(n) === null)],
    olderNotifs: rows.length === NOTIFICATION_PAGE,
  };
}

/**
 * Where "Open event" goes: the organiser's page for the event; for a coordinator, the event selected in their
 * queue (`select`, the page's event id), shown unfiltered; anyone else, the page their role works on.
 * Null when the notification is not about a saved event.
 */
export function notificationTarget(
  n: Pick<NotificationRecord, "eventId">,
  role: Role,
  events: Array<Pick<EventRecord, "id" | "backendId">>,
): { route: string; select?: string } | null {
  if (n.eventId === undefined) return null;
  if (role === "organiser") return { route: `/my-events/${n.eventId}` };
  const event = events.find((e) => e.backendId === n.eventId);
  if (role === "coordinator" && event) return { route: "/queue", select: event.id };
  return { route: DEFAULT_ROUTE[role] };
}
