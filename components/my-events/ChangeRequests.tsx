"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { EventChangeRequest } from "@/lib/types";

/** US33 AC3: read persisted proposals, not the event's current details. */
export function ChangeRequests({ eventId }: { eventId: number }) {
  const [requests, setRequests] = useState<EventChangeRequest[] | null>(null);
  const [error, setError] = useState("");

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

  return (
    <section aria-label="Change requests">
      <h3 style={{ fontSize: 16 }}>Change requests</h3>
      {error ? <p role="alert">{error}</p> : requests === null ? <p>Loading change requests…</p> :
        requests.length === 0 ? <p>No change requests recorded.</p> : (
          <ol style={{ paddingLeft: 20 }}>
            {requests.map((request) => (
              <li key={request.id} style={{ marginBottom: 14 }}>
                <div>Request #{request.id} · {request.status === "pending" ? "Awaiting coordinator review" : request.status}</div>
                <p style={{ whiteSpace: "pre-wrap" }}>{request.proposed_changes}</p>
                <time dateTime={request.requested_at}>{new Date(request.requested_at).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })} SGT</time>
                {typeof request.decision?.reason === "string" && <p>Review outcome: {request.decision.reason}</p>}
              </li>
            ))}
          </ol>
        )}
    </section>
  );
}
