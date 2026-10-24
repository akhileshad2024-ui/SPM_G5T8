"use client";

import { useState } from "react";
import { useApp } from "@/lib/state/app-context";
import { attendanceLabel } from "@/lib/events/details";
import { Tag } from "@/components/ui/Pill";
import { EventDetailsToggle } from "@/components/ui/EventDetails";
import { StatusHistoryToggle } from "@/components/ui/StatusHistory";
import type { EventRecord, Layout, VenueBookingRecord } from "@/lib/types";
import { blockingConflicts, needsManualResolution, pendingConflicts } from "@/lib/venues/conflicts";
import { scheduleIssues } from "@/lib/venues/rules";
import { holdExpiryLabel, toExpiryInput } from "@/lib/venues/hold-expiry";
import { ConflictList } from "./ConflictList";

/** One pending booking request for Venue Staff to decide (US41: an event may have several, one per venue). */
export function BookingRequestCard({ event, booking }: { event: EventRecord; booking: VenueBookingRecord }) {
  const app = useApp();
  const [expiry, setExpiry] = useState(toExpiryInput(booking.hold_expires_at));
  const [saving, setSaving] = useState(false);
  const venue = app.venue(String(booking.venue_id));
  if (!venue) return null;

  // What is wrong with the time itself (venue deactivated, closed that day, outside its hours) is worked out here.
  // What is in the way of the booking comes from the server, which checks it again when the booking is approved:
  // a confirmed booking or an unavailable period stops it (US46, US48); another pending request does not, and is
  // flagged for Venue Staff to resolve by hand (US47).
  const asBooked: EventRecord = { ...event, venue: venue.id, pax: booking.attendance, layout: booking.layout as Layout };
  const issues = scheduleIssues(venue, asBooked);
  if (booking.attendance > venue.cap) {
    issues.push({ level: "warn", text: `Expected attendance of ${booking.attendance} exceeds the ${venue.cap} capacity of ${venue.name}.` });
  }
  const stopping = blockingConflicts(booking);
  const competing = pendingConflicts(booking);
  const blocked = issues.some((i) => i.level === "block") || stopping.length > 0;
  const others = (event.bookings ?? []).filter((b) => b.id !== booking.id && (b.status === "pending" || b.status === "approved"));

  return (
    <div className="card" aria-label={`Booking request: ${event.name} at ${venue.name}`} style={{ padding: "18px 20px", border: blocked ? "1px solid #FF4D5E" : undefined }}>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 250 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{event.name}</div>
            {booking.reassessment && <span className="pill" style={{ background: "var(--bad-bg)", color: "var(--bad-fg)" }}>Requires Reassessment</span>}
            {needsManualResolution(booking) && <span className="pill" style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }}>Needs manual resolution</span>}
          </div>
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
          {holdExpiryLabel(booking) && (
            // US42: the request is a tentative hold; it lapses at this time unless approved.
            <div style={{ fontSize: 12.5, fontWeight: 700, color: booking.hold_notice ? "var(--warn-fg)" : "var(--text)", marginTop: 6 }}>
              {holdExpiryLabel(booking)}
              {booking.hold_expiry_set_by ? ` · set by ${booking.hold_expiry_set_by}` : " · default (3 days after the request)"}
            </div>
          )}
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
          {booking.reassessment && (
            <div className="callout callout-danger" style={{ marginTop: 12 }} role="alert">
              <strong>Requires Reassessment.</strong> {booking.reassessment.message}
              <ConflictList conflicts={booking.reassessment.clashes_with} />
            </div>
          )}
          {stopping.length > 0 && (
            <div className="callout callout-danger" style={{ marginTop: 12 }}>
              <strong>Can&apos;t be approved while this stands.</strong>
              <ConflictList conflicts={stopping} />
            </div>
          )}
          {competing.length > 0 && (
            <div className="callout" style={{ marginTop: 12 }}>
              <strong>Needs manual resolution.</strong> This request conflicts with another pending request. Approve one and reject
              the other, or ask a coordinator to change theirs.
              <ConflictList conflicts={competing} />
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
          <label className="field" style={{ marginTop: 6 }}>
            <span className="eyebrow">Hold expires (campus time)</span>
            <input
              type="datetime-local"
              className="text-input"
              aria-label="Hold expires"
              value={expiry}
              onChange={(ev) => setExpiry(ev.target.value)}
            />
          </label>
          <button
            className="btn btn-ghost"
            style={{ justifyContent: "center" }}
            disabled={saving || !expiry || expiry === toExpiryInput(booking.hold_expires_at)}
            onClick={async () => {
              setSaving(true);
              await app.setHoldExpiry(event.id, booking.id, expiry);
              setSaving(false);
            }}
          >
            Set hold expiry
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
