"use client";

import { useApp } from "@/lib/app-context";
import { AvailabilityCalendar } from "@/components/bookings/AvailabilityCalendar";
import { BookingRequestCard } from "@/components/bookings/BookingRequestCard";

export default function BookingsPage() {
  const app = useApp();
  const pending = app.state.events.filter((e) => e.bookingState === "pending");

  return (
    <div style={{ padding: "24px 26px 34px", display: "flex", flexDirection: "column", gap: 18 }}>
      <AvailabilityCalendar />

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
