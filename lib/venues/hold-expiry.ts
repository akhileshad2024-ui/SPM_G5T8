import type { NotificationRecord, VenueBookingRecord } from "../types";

/**
 * US42 — tentative venue holds expire (Week 7 change CR-W7-4), on the page.
 *
 * The server decides when a hold lapses and what the coordinator should be told
 * (backend/hold_expiry.py, `hold_notice` on each booking); these helpers only show it.
 * Expiry times are entered and shown in campus time (Singapore, UTC+8), like the rest of the app.
 */

const CAMPUS_OFFSET = "+08:00";
const CAMPUS_OFFSET_MS = 8 * 60 * 60 * 1000;

/** A saved expiry (ISO, any zone) as the value of an <input type="datetime-local">, in campus time. */
export function toExpiryInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + CAMPUS_OFFSET_MS).toISOString().slice(0, 16);
}

/** A datetime-local value ("2027-01-02T18:00"), read as campus time, as the ISO the API expects. */
export function fromExpiryInput(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  return `${local}:00${CAMPUS_OFFSET}`;
}

/** "02 Jan 2027, 18:00" in campus time. */
export function formatCampusTime(iso: string): string {
  const [date, time] = toExpiryInput(iso).split("T");
  if (!date) return iso;
  const [y, m, d] = date.split("-");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
  return `${d} ${month} ${y}, ${time}`;
}

/** What to show about a booking's tentative hold, or null when it has none (decided or cancelled). */
export function holdExpiryLabel(booking: Pick<VenueBookingRecord, "status" | "hold_expires_at">): string | null {
  if (!booking.hold_expires_at) return null;
  if (booking.status === "expired") return `Hold expired ${formatCampusTime(booking.hold_expires_at)}`;
  if (booking.status === "pending") return `Held until ${formatCampusTime(booking.hold_expires_at)}`;
  return null;
}

type Notice = Pick<NotificationRecord, "to" | "title" | "body">;

/**
 * US42-AC3: the coordinator is told when a hold is within 24 hours of expiring, and again when it has
 * expired — one notice per booking, from what the server worked out (`hold_notice`).
 */
export function holdNotices(bookings: readonly VenueBookingRecord[]): Notice[] {
  return bookings.flatMap((b): Notice[] => {
    if (!b.hold_expires_at) return [];
    const where = `${b.venue_name} for ${b.event_name}`;
    if (b.hold_notice === "expiring_soon") {
      return [{ to: "coordinator", title: "Venue hold expiring soon", body: `${where} is held until ${formatCampusTime(b.hold_expires_at)}. It is released if not approved by then.` }];
    }
    if (b.hold_notice === "expired") {
      return [{ to: "coordinator", title: "Venue hold expired", body: `${where} expired on ${formatCampusTime(b.hold_expires_at)} and has been released. Request the venue again if it is still needed.` }];
    }
    return [];
  });
}
