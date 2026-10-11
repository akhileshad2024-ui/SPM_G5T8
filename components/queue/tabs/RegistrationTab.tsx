"use client";

import { ProgressBar } from "@/components/ui/ProgressBar";
import { Tag } from "@/components/ui/Pill";
import { formatChangedAt } from "@/lib/events/status-history";
import { useEventRegistrations } from "@/components/registrations/useEventRegistrations";
import type { EventRecord } from "@/lib/types";

/** The event's places taken and its saved registrations (US32). */
export function RegistrationTab({ event }: { event: EventRecord }) {
  const load = useEventRegistrations(event.reg ? event : undefined);
  const pct = event.reg && event.regCap ? Math.min(100, Math.round((event.registered / event.regCap) * 100)) : 0;

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div className="card" style={{ padding: "20px 22px", minWidth: 260 }}>
        <div className="eyebrow">Registered</div>
        <div className="display-number" style={{ fontSize: 58, marginTop: 6 }}>
          {event.registered}
        </div>
        <div className="tabular" style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {event.reg ? `of ${event.regCap} places` : "registration disabled"}
        </div>
        <div style={{ marginTop: 16 }}>
          <ProgressBar pct={pct} />
        </div>
      </div>

      <div className="card" style={{ flex: 1, minWidth: 280, overflow: "hidden" }}>
        <div style={{ padding: "13px 20px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 13 }}>
          Registrations
        </div>
        {event.reg ? (
          load.state === "loading" ? (
            <div className="empty-state" style={{ padding: "34px 20px" }}>Loading registrations…</div>
          ) : load.state === "error" ? (
            <div className="empty-state" style={{ padding: "34px 20px" }}>{load.message}</div>
          ) : load.rows.length === 0 ? (
            <div className="empty-state" style={{ padding: "34px 20px" }}>No one has registered yet.</div>
          ) : (
            load.rows.map((rg) => (
              <div
                key={rg.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 20px",
                  borderBottom: "1px solid rgba(10,14,26,.06)",
                }}
              >
                <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>{rg.attendeeName}</span>
                <span className="tabular" style={{ fontSize: 12, color: "var(--text-faint)" }}>
                  {formatChangedAt(rg.registeredAt)}
                </span>
                <Tag
                  label={rg.status}
                  bg={rg.status === "registered" ? "var(--ok-bg)" : rg.status === "waitlisted" ? "var(--warn-bg)" : "var(--neutral-bg)"}
                  fg={rg.status === "registered" ? "var(--ok-fg)" : rg.status === "waitlisted" ? "var(--warn-fg)" : "var(--neutral-fg)"}
                />
              </div>
            ))
          )
        ) : (
          <div className="empty-state" style={{ padding: "34px 20px" }}>
            Registration is not enabled for this event.
          </div>
        )}
      </div>
    </div>
  );
}
