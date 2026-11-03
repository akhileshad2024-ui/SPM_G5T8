"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { LAYOUT_OPTIONS } from "@/lib/data/options";
import {
  EMPTY_CHANGES, acceptedChangesPayload, describeAcceptedChanges, reassessmentSummary, type AcceptedChangesForm,
} from "@/lib/events/change-reassessment";
import type { EventChangeRequest } from "@/lib/types";

/**
 * US33 outcomes and US34 review share one persisted request list. US49: accepting may say what the change
 * changes; the server re-checks the venue bookings against it (the event itself is not edited) and the result
 * is shown with the request. `onDecided` lets the page reload the bookings it may have flagged.
 */
export function ChangeRequests({ eventId, canReview = false, onDecided }: { eventId: number; canReview?: boolean; onDecided?: () => void }) {
  const [requests, setRequests] = useState<EventChangeRequest[] | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState<Record<number, string>>({});
  const [changes, setChanges] = useState<Record<number, AcceptedChangesForm>>({});
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    setRequests(null);
    setError("");
    apiFetch<EventChangeRequest[]>(`/events/${eventId}/change-requests`).then(
      (saved) => { if (active) setRequests(saved); },
      () => { if (active) setError("Couldn't load change requests. Refresh to try again."); },
    );
    return () => { active = false; };
  }, [eventId]);

  async function decide(requestId: number, outcome: "accepted" | "rejected") {
    // Immediate lock also protects clicks before React redraws disabled buttons.
    if (pending.current) return;
    // US49: only an accepted change carries what it changes.
    const payload = outcome === "accepted" ? acceptedChangesPayload(changes[requestId] ?? EMPTY_CHANGES) : {};
    if (payload.error) { setError(payload.error); return; }
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await apiFetch<EventChangeRequest>(`/events/${eventId}/change-requests/${requestId}/decision`, {
        method: "POST", body: JSON.stringify({ outcome, reason: reason[requestId] ?? "", ...(payload.changes ? { changes: payload.changes } : {}) }),
      });
      setRequests(old => old?.map(item => item.id === saved.id ? saved : item) ?? [saved]);
      onDecided?.();
    } catch {
      setError("Could not save the decision. Refresh to check the latest request before trying again.");
    } finally { pending.current = false; setSaving(false); }
  }

  function setChange(requestId: number, field: keyof AcceptedChangesForm, value: string) {
    setChanges(old => ({ ...old, [requestId]: { ...(old[requestId] ?? EMPTY_CHANGES), [field]: value } }));
  }

  return (
    <section aria-label="Change requests">
      <h3 style={{ fontSize: 16 }}>Change requests</h3>
      {error && <p role="alert">{error}</p>}
      {requests === null ? <p>Loading change requests…</p> :
        requests.length === 0 ? <p>No change requests recorded.</p> : (
          <ol style={{ paddingLeft: 20 }}>
            {requests.map((request) => (
              <li key={request.id} style={{ marginBottom: 14 }}>
                <div>Request #{request.id} · {request.status === "pending" ? "Awaiting coordinator review" : request.status}</div>
                <p style={{ whiteSpace: "pre-wrap" }}>{request.proposed_changes}</p>
                <time dateTime={request.requested_at}>{new Date(request.requested_at).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })} SGT</time>
                {typeof request.decision?.reason === "string" && <p>Review outcome: {request.decision.reason}</p>}
                {typeof request.decision?.by === "string" && <p>Reviewed by {request.decision.by}</p>}
                {typeof request.decision?.at === "string" && <time dateTime={request.decision.at}>
                  {new Date(request.decision.at).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })} SGT
                </time>}
                {request.status === "accepted" && request.venue_reassessment && (
                  <div aria-label={`Venue re-check for request #${request.id}`}>
                    <p>{describeAcceptedChanges(request.accepted_changes)} {reassessmentSummary(request.venue_reassessment)}</p>
                    {request.venue_reassessment.bookings.length > 0 && <ul>{request.venue_reassessment.bookings.map(row => <li key={row.booking_id}>
                      {row.venue_name} ({row.date}, {row.start}–{row.end}):{" "}
                      {row.outcome === "requires_reassessment" ? <>Requires Reassessment. {row.problems.join(" ")}</> :
                        row.resolution ? <>Still fits, reassessed by {row.resolution.by}: {row.resolution.note}</> : "Still fits."}
                    </li>)}</ul>}
                  </div>
                )}
                {canReview && request.status === "pending" && <fieldset disabled={saving} style={{ border: 0, padding: 0 }}>
                  <label htmlFor={`change-reason-${request.id}`}>Review note (optional)</label>
                  <textarea id={`change-reason-${request.id}`} className="text-input" value={reason[request.id] ?? ""}
                    onChange={e => setReason(old => ({ ...old, [request.id]: e.target.value }))} />
                  <fieldset aria-label="If accepted, what the change changes" style={{ border: 0, padding: 0, margin: "8px 0" }}>
                    <p style={{ margin: "0 0 4px" }}>If accepted, what the change changes (leave blank if unchanged). The venue bookings are re-checked against it; the event details are not edited.</p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {([["date", "New date", "date"], ["start", "New start time", "time"], ["end", "New end time", "time"],
                        ["pax", "New expected attendance", "number"]] as const).map(([field, label, type]) => (
                        <label key={field} style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>{label}
                          <input type={type} className="text-input" min={type === "number" ? 1 : undefined} value={changes[request.id]?.[field] ?? ""}
                            onChange={e => setChange(request.id, field, e.target.value)} />
                        </label>
                      ))}
                      <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>New layout
                        <select className="text-input" value={changes[request.id]?.layout ?? ""} onChange={e => setChange(request.id, "layout", e.target.value)}>
                          <option value="">Unchanged</option>
                          {LAYOUT_OPTIONS.map(layout => <option key={layout} value={layout}>{layout[0].toUpperCase() + layout.slice(1)}</option>)}
                        </select>
                      </label>
                    </div>
                  </fieldset>
                  <button className="btn btn-primary" onClick={() => void decide(request.id, "accepted")}>Accept change request</button>
                  <button className="btn btn-danger" onClick={() => void decide(request.id, "rejected")}>Reject change request</button>
                </fieldset>}
              </li>
            ))}
          </ol>
        )}
    </section>
  );
}
