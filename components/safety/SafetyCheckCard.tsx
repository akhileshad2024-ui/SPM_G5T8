"use client";

import { useState } from "react";
import { useApp } from "@/lib/state/app-context";
import { StatusPill } from "@/components/ui/Pill";
import { OUTCOME_LABEL, commentError, concernCount, isAwaiting } from "@/lib/safety/checks";
import type { SafetyCheck, SafetyOutcome } from "@/lib/types";

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * US44: one event for the Safety Officer — everything to review (attendance, venue capacity and layout, emergency
 * access, accessibility, equipment placement, crowd movement, venue restrictions), and, while it is waiting, the
 * decision: approve, request changes or reject, with a comment that is mandatory unless approving.
 */
export function SafetyCheckCard({ check }: { check: SafetyCheck }) {
  const app = useApp();
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const waiting = isAwaiting(check);
  const concerns = concernCount(check);

  async function decide(outcome: SafetyOutcome) {
    const problem = commentError(outcome, comment);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    const ok = await app.decideSafetyCheck(check.eventId, outcome, comment);
    setBusy(false);
    if (ok) setComment("");
  }

  return (
    <div className="card" style={{ padding: "16px 20px" }} aria-label={`Safety check: ${check.name}`}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 15.5, fontWeight: 700 }}>{check.name}</span>
        <StatusPill status={check.status} />
        {waiting && concerns > 0 && (
          <span className="pill" style={{ background: "var(--bad-bg)", color: "var(--bad-fg)" }}>
            {concerns} concern{concerns > 1 ? "s" : ""} flagged
          </span>
        )}
      </div>
      <div className="tabular" style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 6 }}>
        {check.date}{check.start ? `, ${check.start.slice(0, 5)}–${(check.end ?? "").slice(0, 5)}` : ""} · organiser {check.organiser} · coordinator {check.coordinator ?? "none"}
        {check.requestedAt ? ` · waiting since ${when(check.requestedAt)}` : ""}
      </div>
      {check.purpose && <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 4 }}>{check.purpose}</div>}

      {check.arrangementsIssue && waiting && (
        <div className="callout callout-danger" style={{ marginTop: 12 }} role="alert">
          <strong>The arrangements are no longer confirmed.</strong> {check.arrangementsIssue} It can only be rejected or sent back for changes.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10, marginTop: 14 }}>
        {check.areas.map((area) => (
          <section key={area.key} aria-label={area.label} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <strong style={{ fontSize: 13 }}>{area.label}</strong>
              {!area.recorded && <span className="pill" style={{ background: "var(--neutral-bg)", color: "var(--text-muted)" }}>Not recorded</span>}
            </div>
            <ul style={{ margin: "6px 0 0 16px", fontSize: 12.5 }}>
              {area.details.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
            {area.concerns.length > 0 && (
              <ul style={{ margin: "6px 0 0 16px", fontSize: 12.5, color: "var(--bad-fg)" }} aria-label={`${area.label}: concerns`}>
                {area.concerns.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            )}
          </section>
        ))}
      </div>

      {check.reviews.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="eyebrow">Safety history</div>
          <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
            {check.reviews.map((r, i) => (
              <li key={i} style={{ fontSize: 12.5, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                <strong>{OUTCOME_LABEL[r.outcome]}</strong> · {r.reviewer} · {when(r.reviewedAt)}
                {r.comment && <div style={{ color: "var(--text-muted)", marginTop: 2 }}>{r.comment}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {waiting && (
        <div style={{ marginTop: 14 }}>
          <label className="eyebrow" htmlFor={`safety-comment-${check.eventId}`}>Comment</label>
          <textarea
            id={`safety-comment-${check.eventId}`}
            className="textarea-input"
            rows={3}
            value={comment}
            placeholder="Required when rejecting or requesting changes"
            onChange={(e) => setComment(e.target.value)}
            style={{ width: "100%", marginTop: 6 }}
          />
          {error && <div role="alert" style={{ color: "var(--bad-fg)", fontSize: 12.5, marginTop: 6 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button className="btn btn-primary" disabled={busy} onClick={() => decide("approved")}>Approve</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => decide("changes_requested")}>Request changes</button>
            <button className="btn btn-danger" disabled={busy} onClick={() => decide("rejected")}>Reject</button>
          </div>
        </div>
      )}
    </div>
  );
}
