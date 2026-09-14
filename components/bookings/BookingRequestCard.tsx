"use client";

import { useApp } from "@/lib/app-context";
import { Tag } from "@/components/ui/Pill";
import type { EventRecord } from "@/lib/types";

export function BookingRequestCard({ event }: { event: EventRecord }) {
  const app = useApp();
  const venue = event.venue ? app.venue(event.venue) : undefined;
  if (!venue) return null;

  const clash = app.state.events.find(
    (o) => o.id !== event.id && o.venue === event.venue && o.date === event.date && o.bookingState === "approved"
  );
  const warn = clash
    ? `Overlaps with ${clash.name}, already confirmed in ${venue.name} on ${event.date}.`
    : event.pax > venue.cap
      ? `Expected attendance of ${event.pax} exceeds the ${venue.cap} capacity of ${venue.name}.`
      : null;

  return (
    <div className="card" style={{ padding: "18px 20px", border: clash ? "1px solid #FF4D5E" : undefined }}>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 250 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{event.name}</div>
          <div className="tabular" style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 6 }}>
            {venue.name} · {event.date}, {event.start}–{event.end} · {event.pax} pax · requested by{" "}
            {event.coordinator || "coordinator"}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            <Tag label={`${event.layout.charAt(0).toUpperCase() + event.layout.slice(1)} layout`} />
            {event.facilities.map((f) => (
              <Tag key={f} label={f} bg="#fff" fg="#4A5169" border="rgba(10,14,26,.14)" />
            ))}
          </div>
          {warn && <div className="callout callout-danger" style={{ marginTop: 12 }}>{warn}</div>}
        </div>
        <div style={{ width: 200, flex: "none", display: "flex", flexDirection: "column", gap: 8 }}>
          <button className="btn btn-primary" style={{ justifyContent: "center" }} onClick={() => app.approveBooking(event.id)}>
            Approve booking
          </button>
          <button
            className="btn btn-ghost"
            style={{ justifyContent: "center", color: "#B01220" }}
            onClick={() => app.openModal("rejectBooking", event.id)}
          >
            Reject with reason
          </button>
        </div>
      </div>
    </div>
  );
}
