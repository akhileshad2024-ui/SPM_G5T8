"use client";

import { useApp } from "@/lib/state/app-context";
import { attendanceLabel } from "@/lib/events/details";
import { Tag } from "@/components/ui/Pill";
import { EventDetailsToggle } from "@/components/ui/EventDetails";
import { StatusHistoryToggle } from "@/components/ui/StatusHistory";
import type { EventRecord } from "@/lib/types";
import { availabilityIssues } from "@/lib/venues/rules";

export function BookingRequestCard({ event }: { event: EventRecord }) {
  const app = useApp();
  const venue = app.venue(event.venue);
  if (!venue) return null;

  // Checked against confirmed bookings using the occupied window: setup and turnaround included.
  const issues = availabilityIssues(app.state.events, venue, event, "approved");
  if (event.pax > venue.cap) {
    issues.push({ level: "warn", text: `Expected attendance of ${event.pax} exceeds the ${venue.cap} capacity of ${venue.name}.` });
  }
  const blocked = issues.some((i) => i.level === "block");

  return (
    <div className="card" style={{ padding: "18px 20px", border: blocked ? "1px solid #FF4D5E" : undefined }}>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 250 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{event.name}</div>
          <div className="tabular" style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 6 }}>
            {venue.name} · {event.date}, {event.start}–{event.end} · {attendanceLabel(event.pax, "pax")} · requested by{" "}
            {event.coordinator || "coordinator"}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            <Tag label={`${event.layout.charAt(0).toUpperCase() + event.layout.slice(1)} layout`} />
            <Tag label={`${venue.setupMinutes} min setup · ${venue.turnaroundMinutes} min turnaround`} bg="#fff" fg="#4A5169" border="rgba(10,14,26,.14)" />
            {event.facilities.map((f) => (
              <Tag key={f} label={f} bg="#fff" fg="#4A5169" border="rgba(10,14,26,.14)" />
            ))}
          </div>
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
            onClick={() => app.approveBooking(event.id)}
          >
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
      <div style={{ marginTop: 12 }}>
        <EventDetailsToggle event={event} />
        <StatusHistoryToggle event={event} />
      </div>
    </div>
  );
}
