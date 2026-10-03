"use client";

import { useApp } from "@/lib/app-context";
import { Tag } from "@/components/ui/Pill";
import type { EventRecord, Layout } from "@/lib/types";
import { bookingProblems, hasStepFreeAccess, venueHas } from "@/lib/venue-rules";
import styles from "./VenueTab.module.css";

const LAYOUTS: Array<[Layout | "any", string]> = [
  ["any", "Any layout"],
  ["banquet", "Banquet"],
  ["theatre", "Theatre"],
  ["standing", "Standing"],
  ["boardroom", "Boardroom"],
  ["classroom", "Classroom"],
];

export function VenueTab({ event }: { event: EventRecord }) {
  const app = useApp();
  const { vf } = app.state;

  const venues = app.state.venues.filter((v) => v.isActive);
  const minCap = parseInt(vf.cap, 10) || 0;
  const matches = venues.filter(
    (v) => v.cap >= minCap && (vf.layout === "any" || venueHas(v.layouts, vf.layout)) && (!vf.stepFree || hasStepFreeAccess(v))
  );
  // The current booking may have become unusable (venue deactivated/unavailable, or a setup/turnaround clash).
  const currentVenue = app.venue(event.venue);
  const problems = bookingProblems(app.state.events, app.state.venues)[event.id] ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {problems.length > 0 && (
        <div className="callout callout-danger">
          <strong>Alternative arrangements needed for {currentVenue?.name ?? "the booked venue"}.</strong> The event and its other details are kept;
          request a replacement venue below.
          <ul style={{ margin: "6px 0 0 16px" }}>
            {problems.map((p, i) => <li key={i}>{p.text}</li>)}
          </ul>
        </div>
      )}
      <div className={`card ${styles.filters}`}>
        <div className="field">
          <label className="eyebrow">Minimum capacity</label>
          <input className={styles.capInput} value={vf.cap} onChange={(e) => app.setVfCap(e.target.value)} />
        </div>
        <div className="field">
          <label className="eyebrow">Layout</label>
          <select className={styles.select} value={vf.layout} onChange={(e) => app.setVfLayout(e.target.value as Layout | "any")}>
            {LAYOUTS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <label className="checkbox-row" style={{ height: 32 }}>
          <input type="checkbox" checked={vf.stepFree} onChange={app.toggleVfStepFree} />
          Step-free access
        </label>
        <div style={{ flex: 1 }} />
        <div className={styles.count}>
          {matches.length} of {venues.length} venues match
        </div>
      </div>

      <div className={styles.results}>
        {matches.map((v) => {
          const su = app.suitability(v, event);
          const isThis = event.venue === v.id;
          const badge = su.blocked
            ? { bg: "var(--bad-bg)", fg: "var(--bad-fg)" }
            : su.reasons.length
              ? { bg: "var(--warn-bg)", fg: "var(--warn-fg)" }
              : { bg: "var(--ok-bg)", fg: "var(--ok-fg)" };

          const bookLabel =
            isThis && event.bookingState === "pending"
              ? "Requested"
              : isThis && event.bookingState === "approved"
                ? "Booked"
                : su.blocked
                  ? "Not suitable"
                  : "Request booking";
          const bookNote =
            isThis && event.bookingState === "pending"
              ? "Awaiting Venue Staff"
              : isThis && event.bookingState === "approved"
                ? "Confirmed booking"
                : su.blocked
                  ? "Resolve the blockers first"
                  : "Goes to Venue Staff for approval";
          const bookDisabledLook = isThis || su.blocked;

          const onBook = () => {
            if (su.blocked) {
              app.flash(su.reasons[0].text, "warn");
              return;
            }
            if (isThis) return;
            app.requestBooking(event.id, v.id);
          };

          return (
            <div
              key={v.id}
              className={`card ${styles.resultCard}`}
              style={isThis ? { border: "1px solid var(--blue)", boxShadow: "0 10px 32px -8px rgba(20,102,255,.28)" } : undefined}
            >
              <div className={styles.resultBody}>
                <div className={styles.resultMain}>
                  <div className={styles.resultTop}>
                    <span className={styles.resultName}>{v.name}</span>
                    <span className="pill" style={{ background: badge.bg, color: badge.fg }}>
                      {su.verdict}
                    </span>
                  </div>
                  <div className={styles.resultMeta}>
                    {v.building} · capacity {v.cap} · {v.setupMinutes} min setup · {v.turnaroundMinutes} min turnaround
                  </div>
                  <div className={styles.tags}>
                    {v.layouts.map((l) => (
                      <Tag key={l} label={l.charAt(0).toUpperCase() + l.slice(1)} />
                    ))}
                    {v.facilities.map((f) => (
                      <Tag key={f} label={f} bg="#fff" fg="#4A5169" border="rgba(10,14,26,.14)" />
                    ))}
                    <Tag
                      label={hasStepFreeAccess(v) ? "Step-free" : "No step-free access"}
                      bg={hasStepFreeAccess(v) ? "var(--info-bg)" : "var(--bad-bg)"}
                      fg={hasStepFreeAccess(v) ? "var(--info-fg)" : "var(--bad-fg)"}
                    />
                  </div>
                  {su.reasons.length > 0 && (
                    <div className={styles.reasons}>
                      {su.reasons.map((r, i) => (
                        <div key={i} className={`${styles.reason} ${r.level === "block" ? styles.reasonBlock : styles.reasonWarn}`}>
                          {r.text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.bookColumn}>
                  <button
                    className={`btn ${bookDisabledLook ? "btn-muted" : "btn-primary"}`}
                    style={{ justifyContent: "center", cursor: su.blocked ? "not-allowed" : undefined }}
                    onClick={onBook}
                  >
                    {bookLabel}
                  </button>
                  <div className={styles.bookNote}>{bookNote}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
