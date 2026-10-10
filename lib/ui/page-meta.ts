import { needsCoordinatorAction } from "../events/review/review";
import type { EventRecord, Venue } from "../types";

/** Title + subtitle shown in the top bar, per route. Some subtitles are data-dependent. */
export function getPageMeta(pathname: string, events: EventRecord[], venues: Venue[] = []): { title: string; subtitle: string } {
  const actionable = events.filter(needsCoordinatorAction).length;
  const pendingBookings = events.filter((e) => e.bookingState === "pending").length;

  switch (true) {
    case pathname.startsWith("/queue"):
      return { title: "Review queue", subtitle: `${actionable} requests need a decision from you` };
    case pathname.startsWith("/board"):
      return { title: "Pipeline", subtitle: "Every event by stage, across all coordinators" };
    case pathname.startsWith("/my-events"):
      return { title: "My events", subtitle: "Drafts, submitted requests, and approved and confirmed events" };
    case pathname.startsWith("/new-request"):
      return { title: "New event request", subtitle: "Three steps. You can save a draft at any point." };
    case pathname.startsWith("/bookings"):
      return { title: "Booking requests", subtitle: `${pendingBookings} requests pending · conflicts flagged automatically` };
    case pathname.startsWith("/venues"):
      return { title: "Venues", subtitle: "Search and filter venues, and see the details of each" };
    case pathname.startsWith("/catalogue"):
      return { title: "Venue catalogue", subtitle: `${venues.filter((v) => v.isActive).length} active venues, with layouts, facilities, accessibility and setup times` };
    case pathname.startsWith("/equipment"):
      return { title: "Equipment", subtitle: "Availability is calculated against overlapping reservations" };
    case pathname.startsWith("/browse"):
      return { title: "Events open for registration", subtitle: "Register or withdraw at any time before registration closes" };
    case pathname.startsWith("/registrations"):
      return { title: "Event registrations", subtitle: "Monitor attendance, filter statuses, and export event lists" };
    default:
      return { title: "ConnectSphere", subtitle: "" };
  }
}
