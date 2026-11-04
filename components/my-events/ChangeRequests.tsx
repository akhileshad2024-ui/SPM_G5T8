"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { EventChangeRequest, EventDetailsUpdate } from "@/lib/types";
import { ReviewedValues } from "./ReviewedValues";

/** US33 outcomes and US34 review share one persisted request list. */
export function ChangeRequests({ eventId, canReview = false }: { eventId: number; canReview?: boolean }) {
  const [requests, setRequests] = useState<EventChangeRequest[] | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [changes, setChanges] = useState<Record<number, EventDetailsUpdate>>({});

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
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await apiFetch<EventChangeRequest>(`/events/${eventId}/change-requests/${requestId}/decision`, {
        method: "POST", body: JSON.stringify({ outcome, reason: reason[requestId] ?? "",
          ...(outcome === "accepted" && Object.keys(changes[requestId] ?? {}).length ? {effective_changes: changes[requestId]} : {}) }),
      });
      setRequests(old => old?.map(item => item.id === saved.id ? saved : item) ?? [saved]);
      window.dispatchEvent(new Event("arrangements-changed"));
    } catch {
      setError("Could not save the decision. Refresh to check the latest request before trying again.");
    } finally { pending.current = false; setSaving(false); }
  }

  async function apply(requestId: number) {
    if (pending.current) return;
    pending.current = true; setSaving(true); setError("");
    try {
      await apiFetch(`/events/${eventId}/change-requests/${requestId}/apply`, { method: "POST" });
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not apply reviewed changes."); }
    finally { pending.current = false; setSaving(false); }
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
                {canReview && request.status === "pending" && <fieldset disabled={saving} style={{ border: 0, padding: 0 }}>
                  <ReviewedValues value={changes[request.id] ?? {}} onChange={value => setChanges(old => ({...old, [request.id]: value}))} />
                  <label htmlFor={`change-reason-${request.id}`}>Review note (optional)</label>
                  <textarea id={`change-reason-${request.id}`} className="text-input" value={reason[request.id] ?? ""}
                    onChange={e => setReason(old => ({ ...old, [request.id]: e.target.value }))} />
                  <button className="btn btn-primary" onClick={() => void decide(request.id, "accepted")}>Accept change request</button>
                  <button className="btn btn-danger" onClick={() => void decide(request.id, "rejected")}>Reject change request</button>
                </fieldset>}
                {canReview && request.status === "accepted" && (() => {
                  const evaluation = request.decision?.reassessment as { basis?: string; equipment_checked?: number; venue_checked?: number; registration_checked?: boolean; flag_ids?: number[]; effective_changes?: object; applied_at?: string } | undefined;
                  if (!evaluation) return null;
                  return <div aria-label="Accepted change reassessment">
                    <p>Venue bookings checked: {evaluation.venue_checked ?? 0}. Equipment reservations checked: {evaluation.equipment_checked}. Registration settings checked: {evaluation.registration_checked ? "Yes" : "No"}.</p>
                    <p>{evaluation.basis === "reviewed_values" ? "Checked against the reviewed values; event details were retained." : "Checked against current saved details; no structured changes were provided."}</p>
                    <p>Reassessment flags: {evaluation.flag_ids?.length ?? 0}.</p>
                    {!!Object.keys(evaluation.effective_changes ?? {}).length && !evaluation.applied_at && <button className="btn btn-ghost" disabled={saving} onClick={() => void apply(request.id)}>Apply reviewed changes #{request.id}</button>}
                    {evaluation.applied_at && <p>Reviewed changes applied separately.</p>}
                  </div>;
                })()}
              </li>
            ))}
          </ol>
        )}
    </section>
  );
}
