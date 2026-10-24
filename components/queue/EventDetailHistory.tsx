"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { EventDetailChange, EventRecord } from "@/lib/types";

const LABELS: Record<string, string> = {
  name: "Event name", purpose: "Purpose and description", eventType: "Event type",
  pax: "Expected attendance", date: "Proposed date", start: "Start", end: "End",
  venueLocation: "Preferred venue location", venueCapacity: "Required capacity",
  layout: "Layout", facilities: "Facilities", access: "Accessibility", equip: "Equipment",
  reg: "Registration enabled", regCap: "Registration capacity", regClose: "Registration closing date",
};

/** AC2: load persisted important changes, never the browser-only activity list. */
export function EventDetailHistory({ event }: { event: EventRecord }) {
  const [rows, setRows] = useState<EventDetailChange[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (event.backendId === undefined) return;
    let cancelled = false;
    setRows(null); setError("");
    apiFetch<EventDetailChange[]>(`/events/${event.backendId}/detail-changes`).then(
      (saved) => { if (!cancelled) setRows(saved); },
      () => { if (!cancelled) setError("Could not load event detail changes."); },
    );
    return () => { cancelled = true; };
  }, [event.backendId, event.updatedAt]);
  if (event.backendId === undefined) return null;
  return <section aria-label="Event detail changes" className="card" style={{ padding: 20 }}>
    <h3>Event detail changes</h3>
    {error ? <p role="alert">{error}</p> : rows === null ? <p>Loading changes…</p> : rows.length === 0 ? <p>No important detail changes recorded.</p> :
      <ol>{rows.map((row) => <li key={row.id}>
        <p>{row.changedBy} · <time dateTime={row.changedAt}>{new Date(row.changedAt).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })} SGT</time></p>
        <ul>{Object.entries(row.changes).map(([key, value]) => <li key={key}>{LABELS[key] ?? key}: {typeof value === "string" ? value : JSON.stringify(value)}</li>)}</ul>
        {row.affectsArrangements && <p>May affect existing arrangements.</p>}
      </li>)}</ol>}
  </section>;
}
