"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/lib/state/app-context";
import { apiFetch } from "@/lib/api/client";
import { Tag } from "@/components/ui/Pill";
import type { EventRecord, Layout, RequirementCheck, VenueBookingRecord, VenueSuitability } from "@/lib/types";
import { LAYOUT_OPTIONS } from "@/lib/data/options";
import { bookingProblem, holdingBookings } from "@/lib/venues/booking";
import { holdExpiryLabel } from "@/lib/venues/hold-expiry";
import { VERDICT_COLOURS, VERDICT_LABEL, buildSuitabilityRequest, unmetChecks } from "@/lib/venues/suitability";
import { bookingProblems, venueHas } from "@/lib/venues/rules";
import styles from "./VenueTab.module.css";

const LAYOUTS: Array<[Layout | "any", string]> = [
  ["any", "Any layout"],
  ["banquet", "Banquet"],
  ["theatre", "Theatre"],
  ["standing", "Standing"],
  ["boardroom", "Boardroom"],
  ["classroom", "Classroom"],
];

const PURPOSES = ["Main programme", "Breakout session", "Registration and catering", "Overflow"];
const BOOKING_STATUS: Record<VenueBookingRecord["status"], { label: string; bg: string; fg: string }> = {
  pending: { label: "Pending", bg: "var(--warn-bg)", fg: "var(--warn-fg)" },
  approved: { label: "Approved", bg: "var(--ok-bg)", fg: "var(--ok-fg)" },
  rejected: { label: "Rejected", bg: "var(--bad-bg)", fg: "var(--bad-fg)" },
  cancelled: { label: "Cancelled", bg: "var(--neutral-bg)", fg: "var(--text-faint)" },
  expired: { label: "Expired", bg: "var(--neutral-bg)", fg: "var(--text-faint)" }, // US42: hold lapsed unapproved
};
const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** US41: one of the event's venue bookings, which the coordinator can change or cancel on its own. */
function BookingRow({ event, booking }: { event: EventRecord; booking: VenueBookingRecord }) {
  const app = useApp();
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [attendance, setAttendance] = useState(String(booking.attendance));
  const [layout, setLayout] = useState(booking.layout);
  const [purpose, setPurpose] = useState(booking.purpose ?? "");
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const holding = booking.status === "pending" || booking.status === "approved";
  const status = BOOKING_STATUS[booking.status];

  const save = async (acknowledged: boolean) => {
    setBusy(true);
    const result = await app.changeBooking(event.id, booking.id, { attendance: Number(attendance) || undefined, layout: layout as Layout, purpose }, acknowledged);
    setBusy(false);
    if (result.ok) {
      setEditing(false);
      setWarning(null);
    } else if (result.warning) {
      setWarning(result.warning);
    }
  };

  return (
    <li style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }} aria-label={`Booking at ${booking.venue_name}`}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <strong>{booking.venue_name}</strong>
        {booking.purpose && <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{booking.purpose}</span>}
        <span className="pill" style={{ background: status.bg, color: status.fg }}>{status.label}</span>
        <span className="tabular" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          {booking.attendance} people · {capitalise(booking.layout)} layout
        </span>
        <span style={{ flex: 1 }} />
        {holding && !editing && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Change</button>
            {confirmCancel ? (
              <>
                <button className="btn btn-ghost btn-sm" style={{ color: "#B01220" }} disabled={busy}
                  onClick={async () => { setBusy(true); await app.cancelBooking(event.id, booking.id); setBusy(false); setConfirmCancel(false); }}>
                  Confirm cancel
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmCancel(false)}>Keep</button>
              </>
            ) : (
              <button className="btn btn-ghost btn-sm" style={{ color: "#B01220" }} onClick={() => setConfirmCancel(true)}>Cancel booking</button>
            )}
          </>
        )}
      </div>
{holdExpiryLabel(booking) && (
        // US42: when the tentative hold lapses (or lapsed) unless Venue Staff approve it.
        <div style={{ fontSize: 12.5, color: booking.hold_notice ? "var(--warn-fg)" : "var(--text-muted)", marginTop: 4 }}>
          {holdExpiryLabel(booking)}
          {booking.status === "expired" && " — the venue has been released. Request it again if it is still needed."}
        </div>
      )}
      {holding && booking.reassessment && (
        <div className="callout callout-danger" role="alert" style={{ marginTop: 8 }}>
          <strong>Requires Reassessment.</strong> {booking.reassessment.message}
        </div>
      )}
      {booking.status === "rejected" && booking.decision_reason && (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 4 }}>Reason: {booking.decision_reason}</div>
      )}
      {editing && (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginTop: 10 }}>
          <label className="field">
            <span className="eyebrow">Purpose</span>
            <input className={styles.detailInput} style={{ width: 200 }} value={purpose} list="booking-purposes" onChange={(e) => setPurpose(e.target.value)} />
          </label>
          <label className="field">
            <span className="eyebrow">Attendance</span>
            <input className={styles.detailInput} type="number" min={1} value={attendance} onChange={(e) => setAttendance(e.target.value)} />
          </label>
          <label className="field">
            <span className="eyebrow">Layout</span>
            <select className={styles.select} value={layout} onChange={(e) => setLayout(e.target.value)}>
              {LAYOUT_OPTIONS.map((l) => <option key={l} value={l}>{capitalise(l)}</option>)}
            </select>
          </label>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => save(false)}>Save change</button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setEditing(false); setWarning(null); }}>Discard</button>
          {booking.status === "approved" && (
            <div style={{ fontSize: 11.5, color: "var(--text-subtle)", width: "100%" }}>
              Changing an approved booking sends it back to Venue Staff for approval. The event&apos;s other bookings are kept.
            </div>
          )}
          {warning && (
            <div className="callout callout-danger" role="alert" style={{ width: "100%" }}>
              {warning}
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => save(true)}>Acknowledge and save</button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** US41: all of the event's venue bookings and their statuses together, with "cancel all". */
function EventBookings({ event }: { event: EventRecord }) {
  const app = useApp();
  const [confirmAll, setConfirmAll] = useState(false);
  const bookings = event.bookings ?? [];
  if (bookings.length === 0) return null;
  const holding = holdingBookings(event);

  return (
    <div className="card" style={{ padding: "14px 20px" }} aria-label="Venue bookings for this event">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div className="section-heading">Venue bookings for this event</div>
        <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{holding.length} active</span>
        <span style={{ flex: 1 }} />
        {holding.length > 1 && (confirmAll ? (
          <>
            <span style={{ fontSize: 12.5 }}>Cancel all {holding.length} bookings?</span>
            <button className="btn btn-ghost btn-sm" style={{ color: "#B01220" }}
              onClick={async () => { await app.cancelAllBookings(event.id); setConfirmAll(false); }}>
              Yes, cancel all
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmAll(false)}>No</button>
          </>
        ) : (
          <button className="btn btn-ghost btn-sm" style={{ color: "#B01220" }} onClick={() => setConfirmAll(true)}>Cancel all bookings</button>
        ))}
      </div>
      <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
        {bookings.map((b) => <BookingRow key={`${b.id}-${b.status}-${b.attendance}-${b.layout}-${b.purpose}`} event={event} booking={b} />)}
      </ul>
    </div>
  );
}

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
  // US41: the needs of the booking about to be requested; an event may book several venues, each for part of it.
  const [purpose, setPurpose] = useState("");
  const [attendance, setAttendance] = useState(String(event.pax || ""));
  const [layout, setLayout] = useState<Layout>(event.layout);

  const venues = app.state.venues.filter((v) => v.isActive);
  const minCap = parseInt(vf.cap, 10) || 0;
  const matches = venues.filter(
    (v) => v.cap >= minCap && (vf.layout === "any" || venueHas(v.layouts, vf.layout))
  );
  // The current booking may have become unusable (venue deactivated/unavailable, or a setup/turnaround clash).
  const currentVenue = app.venue(event.venue);
  const problems = bookingProblems(app.state.events, app.state.venues)[event.id] ?? [];
  const notBookable = bookingProblem(event);
  const held = holdingBookings(event);
  // Only what differs from the event is sent: the server uses the event's attendance and layout otherwise.
  const ownAttendance = Number(attendance) || undefined;
  const details = {
    attendance: ownAttendance !== event.pax ? ownAttendance : undefined,
    layout: layout !== event.layout ? layout : undefined,
    purpose,
  };

  // Ask the backend how well each venue fits this booking's needs (the event's, unless changed above).
  // Redone whenever those needs or the bookings that could be in the way change.
  const request = JSON.stringify({ ...buildSuitabilityRequest(event), attendance: ownAttendance ?? event.pax, layout });
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
    const ok = await app.requestBooking(event.id, venueId, acknowledged, details);
    setBusy(false);
    if (ok) {
      setConfirming(null);
      setUnderstood(false);
      // Ready for the next booking: back to the event's own needs.
      setPurpose("");
      setAttendance(String(event.pax || ""));
      setLayout(event.layout);
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
      <EventBookings event={event} />
      <datalist id="booking-purposes">
        {PURPOSES.map((p) => <option key={p} value={p} />)}
      </datalist>
      <div className={`card ${styles.filters}`} aria-label="New booking">
        <div className="section-heading" style={{ width: "100%" }}>{held.length ? "Book another venue" : "New booking"}</div>
        <label className="field">
          <span className="eyebrow">Purpose</span>
          <input className={styles.detailInput} style={{ width: 200 }} value={purpose} list="booking-purposes" placeholder="e.g. Main programme"
            onChange={(e) => setPurpose(e.target.value)} />
        </label>
        <label className="field">
          <span className="eyebrow">Attendance</span>
          <input className={styles.detailInput} type="number" min={1} value={attendance} onChange={(e) => setAttendance(e.target.value)} />
        </label>
        <label className="field">
          <span className="eyebrow">Layout</span>
          <select className={styles.select} value={layout} onChange={(e) => setLayout(e.target.value as Layout)}>
            {LAYOUT_OPTIONS.map((l) => <option key={l} value={l}>{capitalise(l)}</option>)}
          </select>
        </label>
        <div style={{ fontSize: 11.5, color: "var(--text-subtle)", flex: 1, minWidth: 200 }}>
          Each venue below is checked against this booking. The event&apos;s other bookings are kept.
        </div>
      </div>
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
          // US41: each venue is booked at most once per event; the event may hold several venues.
          const existing = held.find((b) => String(b.venue_id) === v.id);
          const isThis = existing !== undefined;
          const unmet = unmetChecks(su.checks);
          const badge = VERDICT_COLOURS[su.verdict];
          const fits = su.verdict === "suitable";
          const taken = isThis;

          const bookLabel =
            existing?.status === "pending"
              ? "Requested"
              : existing?.status === "approved"
                ? "Booked"
                : fits
                  ? "Request booking"
                  : "Request anyway…";
          const bookNote = taken
            ? existing?.status === "pending"
              ? "Awaiting Venue Staff"
              : "Confirmed booking"
            : notBookable
              ? notBookable
              : fits
                ? "Goes to Venue Staff for approval"
                : "Needs your acknowledgement of the warning";

          const onBook = () => {
            if (taken || busy) return;
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
                    className={`btn ${taken || notBookable ? "btn-muted" : "btn-primary"}`}
                    style={{ justifyContent: "center", cursor: taken || notBookable ? "not-allowed" : undefined }}
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
