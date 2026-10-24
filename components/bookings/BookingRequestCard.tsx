"use client";

import { useApp } from "@/lib/state/app-context";
import { attendanceLabel } from "@/lib/events/details";
import { Tag } from "@/components/ui/Pill";
import { EventDetailsToggle } from "@/components/ui/EventDetails";
import { StatusHistoryToggle } from "@/components/ui/StatusHistory";
import type { EventRecord, Layout, VenueBookingRecord } from "@/lib/types";
import { availabilityIssues } from "@/lib/venues/rules";

/** One pending booking request for Venue Staff to decide (US41: an event may have several, one per venue). */
export function BookingRequestCard({ event, booking }: { event: EventRecord; booking: VenueBookingRecord }) {
  const app = useApp();
  const venue = app.venue(String(booking.venue_id));
  if (!venue) return null;

  // Checked against confirmed bookings using the occupied window: setup and turnaround included.
  const asBooked: EventRecord = { ...event, venue: venue.id, pax: booking.attendance, layout: booking.layout as Layout };
  const issues = availabilityIssues(app.state.events, venue, asBooked, "approved");
  if (booking.attendance > venue.cap) {
    issues.push({ level: "warn", text: `Expected attendance of ${booking.attendance} exceeds the ${venue.cap} capacity of ${venue.name}.` });
  }
  const blocked = issues.some((i) => i.level === "block");
  const others = (event.bookings ?? []).filter((b) => b.id !== booking.id && (b.status === "pending" || b.status === "approved"));

  return (
    <div className="card" aria-label={`Booking request: ${event.name} at ${venue.name}`} style={{ padding: "18px 20px", border: blocked ? "1px solid #FF4D5E" : undefined }}>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 250 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{event.name}</div>
          <div className="tabular" style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 6 }}>
            {venue.name}
            {booking.purpose ? ` · ${booking.purpose}` : ""} · {event.date}, {event.start}–{event.end} · {attendanceLabel(booking.attendance, "pax")} ·
            requested by {event.coordinator || "coordinator"}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            <Tag label={`${booking.layout.charAt(0).toUpperCase() + booking.layout.slice(1)} layout`} />
            <Tag label={`${venue.setupMinutes} min setup · ${venue.turnaroundMinutes} min turnaround`} bg="#fff" fg="#4A5169" border="rgba(10,14,26,.14)" />
            {event.facilities.map((f) => (
              <Tag key={f} label={f} bg="#fff" fg="#4A5169" border="rgba(10,14,26,.14)" />
            ))}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
            Held from {new Date(booking.hold_start).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} to{" "}
            {new Date(booking.hold_end).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
            {" "}({booking.setup_minutes} min setup, {booking.teardown_minutes} min teardown) · {booking.attendance} people
          </div>
          {others.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
              This event also has: {others.map((b) => `${b.venue_name}${b.purpose ? ` (${b.purpose})` : ""}, ${b.status}`).join("; ")}
            </div>
          )}
          {booking.override && (
            <div className="callout" style={{ marginTop: 12 }}>
              <strong>Requested despite the venue being {booking.override.verdict.replace("_", " ")}.</strong>{" "}
              {booking.override.acknowledged_by} acknowledged the warning:
              <ul style={{ margin: "6px 0 0 16px" }}>
                {booking.override.unmet.map((u, n) => <li key={n}>{u.reason}</li>)}
              </ul>
            </div>
          )}
          {issues.map((i, n) => (
            <div key={n} className={`callout ${i.level === "block" ? "callout-danger" : ""}`} style={{ marginTop: 12 }}>
              {i.text}
            </div>
          ))}
        </div>
        <div style={{ width: 200, flex: "none", display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            className={`btn ${blocked ? "btn-muted" : "btn-primary"}`}
            style={{ justifyContent: "center", cursor: blocked ? "not-allowed" : undefined }}
            onClick={() => app.approveBooking(event.id, booking.id)}
          >
            Approve booking
          </button>
          <button
            className="btn btn-ghost"
            style={{ justifyContent: "center", color: "#B01220" }}
            onClick={() => app.openModal("rejectBooking", event.id, booking.id)}
          >
            Reject with reason
          </button>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <EventDetailsToggle event={event} />
        <StatusHistoryToggle event={event} />
      </div>
    </div>
  );
}
