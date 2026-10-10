import { useState, type ReactNode } from "react";
import { useApp, type SaveVenueResult } from "@/lib/state/app-context";
import { Tag } from "@/components/ui/Pill";
import type { Venue } from "@/lib/types";
import { UNAVAILABILITY_REASONS, formatDateTime, holdsBooking, parseDateTime } from "@/lib/venues/rules";
import { VenueForm } from "./VenueForm";

const eyebrow = { fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 7 } as const;

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div style={eyebrow}>{title}</div>
      {children}
    </div>
  );
}

function shortDays(days: string[]): string {
  if (days.length === 7) return "Every day";
  return days.map((d) => d.slice(0, 3)).join(", ");
}

export function VenueCard({ venue }: { venue: Venue }) {
  const app = useApp();
  const [isEditing, setIsEditing] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

  // Bookings at this venue that aren't closed — deactivating flags them, it never cancels them.
  const bookings = app.state.events.filter((e) => e.venue === venue.id && holdsBooking(e));
  const confirmed = bookings.filter((e) => e.bookingState === "approved").length;

  const reportSaved = (result: Extract<SaveVenueResult, { ok: true }>, verb: string) => {
    const n = result.flagged.length;
    app.flash(
      n ? `${venue.name} ${verb}. ${n} booking${n > 1 ? "s" : ""} flagged to coordinators.` : `${venue.name} ${verb}.`,
      n ? "warn" : "ok",
    );
  };

  const setActive = async (active: boolean) => {
    setConfirmingDeactivate(false);
    const result = await app.setVenueActive(venue.id, active);
    if (result.ok) reportSaved(result, active ? "reactivated" : "deactivated");
    else app.flash(result.error, "bad");
  };

  if (isEditing) {
    return (
      <VenueForm
        initialData={venue}
        onSuccess={(result) => {
          setIsEditing(false);
          reportSaved(result, "updated");
        }}
        onCancel={() => setIsEditing(false)}
      />
    );
  }

  return (
    <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, opacity: venue.isActive ? 1 : 0.75 }}>
      <div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{venue.name}</div>
          {!venue.isActive && <span className="pill" style={{ background: "var(--bad-bg)", color: "var(--bad-fg)" }}>Deactivated</span>}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>{venue.location}</div>
      </div>

      <div style={{ display: "flex", gap: 20 }}>
        {[
          [venue.cap, "Capacity"],
          [confirmed, "Bookings"],
        ].map(([value, label]) => (
          <div key={label}>
            <div className="display-number" style={{ fontSize: 30 }}>{value}</div>
            <div style={{ ...eyebrow, marginTop: 5, marginBottom: 0 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ height: 1, background: "var(--border)" }} />

      <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 3 }}>
        <div><strong>Hours:</strong> {venue.operatingHours ?? "Not recorded"} · {shortDays(venue.operatingDays)}</div>
        <div><strong>Setup:</strong> {venue.setupMinutes} min · <strong>Turnaround:</strong> {venue.turnaroundMinutes} min</div>
      </div>

      <Block title="Layouts">
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {venue.layouts.map((l) => (
            <span key={l} style={{ fontSize: 11.5, padding: "3px 9px", border: "1px solid var(--border-strong)", borderRadius: 999, textTransform: "capitalize" }}>
              {l}
            </span>
          ))}
        </div>
      </Block>

      {venue.facilities.length > 0 && (
        <Block title="Facilities">
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {venue.facilities.map((f) => <Tag key={f} label={f} />)}
          </div>
        </Block>
      )}

      {venue.accessibility.length > 0 && (
        <Block title="Accessibility">
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {venue.accessibility.map((a) => <Tag key={a} label={a} />)}
          </div>
        </Block>
      )}

      {venue.unavailability.length > 0 && (
        <Block title="Unavailable">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {venue.unavailability.map((p, i) => {
              const start = parseDateTime(p.start);
              const end = parseDateTime(p.end);
              return (
                <div key={i} style={{ fontSize: 11, padding: "4px 8px", background: "#ffeaea", color: "var(--bad-dot)", borderRadius: 4 }}>
                  <strong>{UNAVAILABILITY_REASONS[p.reason] ?? p.reason}</strong>
                  {start != null && end != null && ` · ${formatDateTime(start)} – ${formatDateTime(end)}`}
                  {p.note && ` · ${p.note}`}
                </div>
              );
            })}
          </div>
        </Block>
      )}

      <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
        Last changed by {venue.lastUpdatedBy} · {new Date(venue.lastUpdatedAt).toLocaleString("en-GB")}
      </div>

      {confirmingDeactivate && (
        <div className="callout callout-danger" style={{ fontSize: 12 }}>
          {bookings.length ? (
            <>
              <div style={{ marginBottom: 6 }}>
                {bookings.length} booking{bookings.length > 1 ? "s" : ""} at {venue.name} will be kept and flagged so the coordinator can find another venue:
              </div>
              <ul style={{ margin: "0 0 8px 16px" }}>
                {bookings.map((e) => (
                  <li key={e.id}>{e.name} · {e.date} ({e.bookingState === "approved" ? "confirmed" : "pending"})</li>
                ))}
              </ul>
            </>
          ) : (
            <div style={{ marginBottom: 8 }}>No current bookings use {venue.name}.</div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setConfirmingDeactivate(false)} style={{ fontSize: 12, padding: "4px 8px", background: "#f0f0f0", borderRadius: 4 }}>
              Keep active
            </button>
            <button onClick={() => setActive(false)} style={{ fontSize: 12, padding: "4px 8px", color: "#fff", background: "var(--bad-dot)", borderRadius: 4 }}>
              Deactivate venue
            </button>
          </div>
        </div>
      )}

      <div style={{ height: 1, background: "var(--border)", marginTop: 10 }} />
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 5 }}>
        <button onClick={() => setIsEditing(true)} style={{ fontSize: 12, padding: "4px 8px", background: "#f0f0f0", borderRadius: 4 }}>
          Edit
        </button>
        {venue.isActive ? (
          <button onClick={() => setConfirmingDeactivate(true)} style={{ fontSize: 12, padding: "4px 8px", color: "var(--bad-dot)", background: "#ffeaea", borderRadius: 4 }}>
            Deactivate
          </button>
        ) : (
          <button onClick={() => setActive(true)} style={{ fontSize: 12, padding: "4px 8px", background: "#e0f7f4", color: "#006b60", borderRadius: 4 }}>
            Reactivate
          </button>
        )}
      </div>
    </div>
  );
}
