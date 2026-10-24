"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { EventChangeRequest } from "@/lib/types";

/** US33 outcomes and US34 review share one persisted request list. */
export function ChangeRequests({ eventId, canReview = false }: { eventId: number; canReview?: boolean }) {
  const [requests, setRequests] = useState<EventChangeRequest[] | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState<Record<number, string>>({});
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
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await apiFetch<EventChangeRequest>(`/events/${eventId}/change-requests/${requestId}/decision`, {
        method: "POST", body: JSON.stringify({ outcome, reason: reason[requestId] ?? "" }),
      });
      setRequests(old => old?.map(item => item.id === saved.id ? saved : item) ?? [saved]);
    } catch {
      setError("Could not save the decision. Refresh to check the latest request before trying again.");
    } finally { pending.current = false; setSaving(false); }
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
                  <label htmlFor={`change-reason-${request.id}`}>Review note (optional)</label>
                  <textarea id={`change-reason-${request.id}`} className="text-input" value={reason[request.id] ?? ""}
                    onChange={e => setReason(old => ({ ...old, [request.id]: e.target.value }))} />
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
