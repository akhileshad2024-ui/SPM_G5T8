"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/lib/app-context";
import { apiFetch } from "@/lib/api";
import { Tag } from "@/components/ui/Pill";
import type { EventRecord, Layout, RequirementCheck, VenueSuitability } from "@/lib/types";
import { bookingProblem } from "@/lib/venue-booking";
import { VERDICT_COLOURS, VERDICT_LABEL, buildSuitabilityRequest, unmetChecks } from "@/lib/venue-suitability";
import { bookingProblems, venueHas } from "@/lib/venue-rules";
import styles from "./VenueTab.module.css";

const LAYOUTS: Array<[Layout | "any", string]> = [
  ["any", "Any layout"],
  ["banquet", "Banquet"],
  ["theatre", "Theatre"],
  ["standing", "Standing"],
  ["boardroom", "Boardroom"],
  ["classroom", "Classroom"],
];

/** Every need the event has recorded, set against what the venue offers (US21: the comparison behind the verdict). */
function Comparison({ checks }: { checks: RequirementCheck[] }) {
  return (
    <details style={{ marginTop: 10, fontSize: 12.5 }}>
      <summary style={{ cursor: "pointer", color: "var(--text-muted)" }}>Compared with this event&apos;s venue needs</summary>
      <table style={{ width: "100%", marginTop: 6, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--text-faint)" }}>
            <th style={{ padding: "3px 6px 3px 0" }}>Requirement</th>
            <th style={{ padding: "3px 6px" }}>Event needs</th>
            <th style={{ padding: "3px 6px" }}>Venue offers</th>
            <th style={{ padding: "3px 0 3px 6px" }}>Met</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c, i) => (
            <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
              <td style={{ padding: "4px 6px 4px 0" }}>{c.label}</td>
              <td style={{ padding: "4px 6px" }}>{c.needed}</td>
              <td style={{ padding: "4px 6px" }}>{c.offered}</td>
              <td style={{ padding: "4px 0 4px 6px", fontWeight: 700, color: c.met ? "var(--ok-fg)" : c.severity === "block" ? "var(--bad-fg)" : "var(--warn-fg)" }}>
                {c.met ? "Yes" : "No"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function VenueTab({ event }: { event: EventRecord }) {
  const app = useApp();
  const { vf } = app.state;
  const [suitability, setSuitability] = useState<Record<string, VenueSuitability>>({});
  const [checking, setChecking] = useState(true);
  // The venue the coordinator is about to request despite it not being fully suitable, until they acknowledge the warning.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);

  const venues = app.state.venues.filter((v) => v.isActive);
  const minCap = parseInt(vf.cap, 10) || 0;
  const matches = venues.filter(
    (v) => v.cap >= minCap && (vf.layout === "any" || venueHas(v.layouts, vf.layout))
  );
  // The current booking may have become unusable (venue deactivated/unavailable, or a setup/turnaround clash).
  const currentVenue = app.venue(event.venue);
  const problems = bookingProblems(app.state.events, app.state.venues)[event.id] ?? [];
  const notBookable = bookingProblem(event);

  // Ask the backend how well each venue fits this event's recorded needs. Redone whenever those needs
  // or the bookings that could be in the way change.
  const request = JSON.stringify(buildSuitabilityRequest(event, app.state.events));
  const catalogue = app.state.venues.length;
  useEffect(() => {
    if (!catalogue) return;
    let current = true;
    setChecking(true);
    apiFetch<{ results: VenueSuitability[] }>("/venues/suitability", { method: "POST", body: request })
      .then((res) => {
        if (current) setSuitability(Object.fromEntries(res.results.map((r) => [String(r.venue.id), r])));
      })
      .catch((err) => current && app.handleApiError(err))
      .finally(() => current && setChecking(false));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, catalogue]);

  const submitRequest = async (venueId: string, acknowledged: boolean) => {
    setBusy(true);
    const ok = await app.requestBooking(event.id, venueId, acknowledged);
    setBusy(false);
    if (ok) {
      setConfirming(null);
      setUnderstood(false);
    }
  };

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
      {(event.venueOverrides ?? []).length > 0 && (
        <div className="callout">
          <strong>Overrides recorded against this event</strong>
          <ul style={{ margin: "6px 0 0 16px" }}>
            {(event.venueOverrides ?? []).map((o, i) => (
              <li key={i}>
                {o.acknowledged_by} went ahead with a venue that was {VERDICT_LABEL[o.verdict].toLowerCase()} ({new Date(o.acknowledged_at).toLocaleString("en-GB")}):{" "}
                {o.unmet.map((u) => u.reason).join(" ")}
              </li>
            ))}
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
        <div style={{ flex: 1 }} />
        <div className={styles.count}>
          {matches.length} of {venues.length} venues match
        </div>
      </div>

      <div className={styles.results}>
        {checking && matches.length > 0 && Object.keys(suitability).length === 0 && (
          <div className="card" style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--text-subtle)" }}>
            Checking each venue against this event&apos;s needs…
          </div>
        )}
        {matches.map((v) => {
          const su = suitability[v.id];
          if (!su) return null;
          const isThis = event.venue === v.id;
          const unmet = unmetChecks(su.checks);
          const badge = VERDICT_COLOURS[su.verdict];
          const fits = su.verdict === "suitable";
          const held = isThis && (event.bookingState === "pending" || event.bookingState === "approved");

          const bookLabel =
            isThis && event.bookingState === "pending"
              ? "Requested"
              : isThis && event.bookingState === "approved"
                ? "Booked"
                : fits
                  ? "Request booking"
                  : "Request anyway…";
          const bookNote = held
            ? event.bookingState === "pending"
              ? "Awaiting Venue Staff"
              : "Confirmed booking"
            : notBookable
              ? notBookable
              : fits
                ? "Goes to Venue Staff for approval"
                : "Needs your acknowledgement of the warning";

          const onBook = () => {
            if (held || busy) return;
            if (notBookable) {
              app.flash(notBookable, "warn");
              return;
            }
            if (fits) {
              submitRequest(v.id, false);
            } else {
              setUnderstood(false);
              setConfirming(v.id);
            }
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
                      {VERDICT_LABEL[su.verdict]}
                    </span>
                  </div>
                  <div className={styles.resultMeta}>
                    {v.location} · capacity {v.cap} · {v.setupMinutes} min setup · {v.turnaroundMinutes} min turnaround
                  </div>
                  <div className={styles.tags}>
                    {v.layouts.map((l) => (
                      <Tag key={l} label={l.charAt(0).toUpperCase() + l.slice(1)} />
                    ))}
                    {v.facilities.map((f) => (
                      <Tag key={f} label={f} bg="#fff" fg="#4A5169" border="rgba(10,14,26,.14)" />
                    ))}
                    {v.accessibility.map((a) => (
                      <Tag key={a} label={a} bg="var(--info-bg)" fg="var(--info-fg)" />
                    ))}
                  </div>
                  {unmet.length > 0 && (
                    <div className={styles.reasons}>
                      {unmet.map((c, i) => (
                        <div key={i} className={`${styles.reason} ${c.severity === "block" ? styles.reasonBlock : styles.reasonWarn}`}>
                          {c.reason}
                        </div>
                      ))}
                    </div>
                  )}
                  <Comparison checks={su.checks} />
                </div>
                <div className={styles.bookColumn}>
                  <button
                    className={`btn ${held || notBookable ? "btn-muted" : "btn-primary"}`}
                    style={{ justifyContent: "center", cursor: held || notBookable ? "not-allowed" : undefined }}
                    onClick={onBook}
                    disabled={busy}
                  >
                    {bookLabel}
                  </button>
                  <div className={styles.bookNote}>{bookNote}</div>
                </div>
              </div>

              {confirming === v.id && !fits && (
                <div className="callout callout-danger" style={{ marginTop: 12 }} role="alert">
                  <strong>
                    {v.name} is {VERDICT_LABEL[su.verdict].toLowerCase()} for this event.
                  </strong>{" "}
                  You can still request it, but the unmet requirements above will be recorded against the event as an override.
                  <label className="checkbox-row" style={{ marginTop: 8 }}>
                    <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />I acknowledge the warning and want to request this venue anyway
                  </label>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button className="btn btn-primary" disabled={!understood || busy} onClick={() => submitRequest(v.id, true)}>
                      {busy ? "Requesting…" : "Request booking anyway"}
                    </button>
                    <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
