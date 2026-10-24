"use client";

import { useApp } from "@/lib/state/app-context";
import { AvailabilityCalendar } from "@/components/bookings/AvailabilityCalendar";
import { BookingRequestCard } from "@/components/bookings/BookingRequestCard";
import { ConflictList } from "@/components/bookings/ConflictList";
import { needsManualResolution, reassessmentList } from "@/lib/venues/conflicts";
import { bookingProblems } from "@/lib/venues/rules";

export default function BookingsPage() {
  const app = useApp();
  // US41: one card per pending booking; an event may be waiting on several venues.
  const pending = app.state.events.flatMap((e) => (e.bookings ?? []).filter((b) => b.status === "pending").map((b) => ({ event: e, booking: b })));
  // Confirmed bookings that a venue change (setup/turnaround, unavailability, deactivation) has put in trouble.
  // They are listed here, never removed (Week 7 changes #1 and #2).
  const problems = bookingProblems(app.state.events, app.state.venues);
  // US38: bookings a venue time change has left overlapping another one. They are listed below with the booking
  // they clash with, so a confirmed one is not listed a second time here.
  const reassess = reassessmentList(app.state.events);
  const troubled = app.state.events.filter(
    (e) => e.bookingState === "approved" && problems[e.id] && !(e.bookings ?? []).some((b) => b.status === "approved" && b.reassessment),
  );
  // US47: pending requests that overlap another pending request, for Venue Staff to resolve by hand.
  const competing = pending.filter(({ booking }) => needsManualResolution(booking));

  return (
    <div style={{ padding: "24px 26px 34px", display: "flex", flexDirection: "column", gap: 18 }}>
      <AvailabilityCalendar />

      {troubled.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="section-heading">Confirmed bookings needing attention</div>
          {troubled.map((e) => (
            <div key={e.id} className="card callout-danger" style={{ padding: "14px 18px", border: "1px solid #FF4D5E" }}>
              <div style={{ fontWeight: 700 }}>
                {e.name} · {app.venue(e.venue)?.name} · {e.date}, {e.start}–{e.end}
              </div>
              <ul style={{ margin: "6px 0 0 16px", fontSize: 12.5 }}>
                {problems[e.id].map((p, i) => <li key={i}>{p.text}</li>)}
              </ul>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                The booking is kept; {e.coordinator ?? "the coordinator"} has been asked to arrange an alternative.
              </div>
            </div>
          ))}
        </div>
      )}

      {reassess.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="section-heading">Bookings requiring reassessment</div>
          {reassess.map(({ event, booking }) => (
            <div
              key={booking.id}
              className="card callout-danger"
              aria-label={`Requires reassessment: ${event.name} at ${booking.venue_name}`}
              style={{ padding: "14px 18px", border: "1px solid #FF4D5E" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700 }}>
                  {event.name} · {booking.venue_name} · {booking.date}, {booking.start}–{booking.end}
                </span>
                <span className="pill" style={{ background: "var(--neutral-bg)", color: "var(--text-muted)" }}>
                  {booking.status === "approved" ? "Confirmed" : "Pending"}
                </span>
                <span className="pill" style={{ background: "var(--bad-bg)", color: "var(--bad-fg)" }}>Requires Reassessment</span>
              </div>
              <div style={{ fontSize: 12.5, marginTop: 6 }}>{booking.reassessment!.message}</div>
              <ConflictList conflicts={booking.reassessment!.clashes_with} />
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                The booking is kept; {event.coordinator ?? "the coordinator"} has been told to reassess it.
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="section-heading">Pending booking requests</div>
        {competing.length > 0 && (
          <div className="callout" role="status">
            <strong>
              {competing.length} pending request{competing.length > 1 ? "s" : ""} conflict{competing.length > 1 ? "" : "s"} with another pending request.
            </strong>{" "}
            Nothing is decided for you: approve the one you want, then reject or ask for a change to the others.
          </div>
        )}
        {pending.map(({ event, booking }) => (
          <BookingRequestCard key={booking.id} event={event} booking={booking} />
        ))}
        {pending.length === 0 && (
          <div className="card" style={{ padding: 46, textAlign: "center", fontSize: 13, color: "var(--text-subtle)" }}>
            No booking requests are waiting on you.
          </div>
        )}
      </div>
    </div>
  );
}
