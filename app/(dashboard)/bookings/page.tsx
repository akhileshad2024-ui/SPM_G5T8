"use client";

import { useApp } from "@/lib/state/app-context";
import { AvailabilityCalendar } from "@/components/bookings/AvailabilityCalendar";
import { BookingRequestCard } from "@/components/bookings/BookingRequestCard";
import { bookingProblems } from "@/lib/venues/rules";

export default function BookingsPage() {
  const app = useApp();
  const pending = app.state.events.filter((e) => e.bookingState === "pending");
  // Confirmed bookings that a venue change (setup/turnaround, unavailability, deactivation) has put in trouble.
  // They are listed here, never removed (Week 7 changes #1 and #2).
  const problems = bookingProblems(app.state.events, app.state.venues);
  const troubled = app.state.events.filter((e) => e.bookingState === "approved" && problems[e.id]);

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

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="section-heading">Pending booking requests</div>
        {pending.map((e) => (
          <BookingRequestCard key={e.id} event={e} />
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
