"use client";

import { useState } from "react";
import { useApp } from "@/lib/state/app-context";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Tag } from "@/components/ui/Pill";
import { EventDetailsToggle } from "@/components/ui/EventDetails";
import { StatusHistoryToggle } from "@/components/ui/StatusHistory";
import type { EventRecord } from "@/lib/types";

export function PublicEventCard({ event }: { event: EventRecord }) {
  const app = useApp();
  const [confirmWithdrawal, setConfirmWithdrawal] = useState(false);
  const venue = event.venue ? app.venue(event.venue) : undefined;
  const full = event.registered >= event.regCap;
  const registration = app.state.registrations.find((r) => r.eventId === event.id && r.attendeeEmail === app.me.email && r.status !== "withdrawn");
  const mine = !!registration;

  const btnLabel = mine ? "Withdraw" : full ? "Join waitlist" : "Register";
  const btnVariant = mine ? "btn-danger" : "btn-primary";

  const onClick = () => {
    if (mine) setConfirmWithdrawal(true);
    else app.registerForEvent(event.id);
  };

  return (
    <div
      className="card"
      style={{
        padding: "20px 22px",
        border: mine ? "1px solid var(--blue)" : undefined,
        boxShadow: mine ? "0 10px 32px -8px rgba(20,102,255,.22)" : undefined,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-open-sans)", fontWeight: 800, fontSize: 18, letterSpacing: "-.02em", lineHeight: 1.25 }}>
            {event.name}
          </div>
          <div className="tabular" style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 7 }}>
            {event.date} · {event.start}–{event.end}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            {/* Attendees get the venue's name only, not the booking (US15). */}
            {venue ? `${venue.name} · ${venue.location}` : event.venueName ?? "Venue to be confirmed"}
          </div>
        </div>
        {registration && <Tag label={registration.status} bg={registration.status === "waitlisted" ? "var(--warn-bg)" : "var(--ok-bg)"} fg={registration.status === "waitlisted" ? "var(--warn-fg)" : "var(--ok-fg)"} />}
      </div>

      <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginTop: 12 }}>{event.purpose}</div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 120 }}>
          <ProgressBar pct={(event.registered / event.regCap) * 100} color={full ? "#FF4D5E" : "#1466FF"} thin />
          <div className="tabular" style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>
            {event.registered} of {event.regCap} places taken{full ? " · full" : ""}
          </div>
        </div>
        <button className={`btn ${btnVariant}`} style={{ justifyContent: "center", padding: "0 20px" }} onClick={onClick}>
          {btnLabel}
        </button>
      </div>
      {confirmWithdrawal && <div className="callout callout-warn" style={{ marginTop: 12 }}>
        <div>Withdraw your registration for {event.name}?</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn btn-sm btn-danger" onClick={() => { app.withdrawRegistration(event.id); setConfirmWithdrawal(false); }}>Confirm withdrawal</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setConfirmWithdrawal(false)}>Keep registration</button>
        </div>
      </div>}
      <div style={{ marginTop: 12 }}>
        <EventDetailsToggle event={event} />
        <StatusHistoryToggle event={event} />
      </div>
    </div>
  );
}
