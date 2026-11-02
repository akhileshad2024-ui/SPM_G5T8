import type { Role } from "../types";

/** Route each role lands on immediately after signing in. */
export const DEFAULT_ROUTE: Record<Role, string> = {
  organiser: "/my-events",
  coordinator: "/queue",
  venue: "/bookings",
  tech: "/equipment",
  attendee: "/browse",
  lead: "/assignments",
  safety: "/safety",
};

/** Sidebar navigation, per role: [route, label]. */
export const NAV_FOR: Record<Role, Array<[string, string]>> = {
  organiser: [
    ["/my-events", "My events"],
    ["/new-request", "New request"],
    ["/registrations", "Event registrations"],
  ],
  coordinator: [
    ["/queue", "Review queue"],
    ["/board", "Pipeline"],
    ["/venues", "Venues"],
    ["/calendar", "Venue calendar"],
    ["/registrations", "Event registrations"],
  ],
  venue: [
    ["/bookings", "Booking requests"],
    ["/catalogue", "Venue catalogue"],
  ],
  tech: [
    ["/equipment", "Equipment"],
    ["/calendar", "Venue calendar"],
  ],
  attendee: [["/browse", "Browse events"]],
  // US43: the Event Coordinator Lead's unassigned queue and coordinators' assignments.
  lead: [["/assignments", "Assignments"]],
  // US44: the Safety Officer's events awaiting an Operational Safety Check.
  safety: [["/safety", "Safety checks"]],
};

/**
 * Client-side route guard: a role may only open the pages in its own nav.
 * This only hides UI — the backend enforces the real permissions.
 */
export function canAccessRoute(role: Role, pathname: string): boolean {
  return NAV_FOR[role].some(([route]) => pathname === route || pathname.startsWith(`${route}/`));
}

export const NO_PAGE_PERMISSION = "You don't have permission to view that page.";

/**
 * Where to send a signed-in user who opened `pathname`, and the authorisation
 * error to show them (US02); null when they may stay on the page.
 */
export function routeRedirect(role: Role, pathname: string): { to: string; message: string } | null {
  if (canAccessRoute(role, pathname)) return null;
  return { to: DEFAULT_ROUTE[role], message: NO_PAGE_PERMISSION };
}
