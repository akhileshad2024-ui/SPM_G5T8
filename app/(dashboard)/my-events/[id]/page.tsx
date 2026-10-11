"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/lib/state/app-context";
import { eventFromApi, eventKey } from "@/lib/events/request/api";
import { EventDetails } from "@/components/ui/EventDetails";
import { StatusHistoryToggle } from "@/components/ui/StatusHistory";
import { StatusPill } from "@/components/ui/Pill";
import type { EventRecord } from "@/lib/types";

/** US15: one of the organiser's event requests, with its latest saved details. */
export default function EventDetailsPage() {
  const app = useApp();
  const params = useParams<{ id: string }>();
  const backendId = Number(params.id);
  const valid = Number.isInteger(backendId) && backendId > 0;
  const listed = valid ? app.event(eventKey(backendId)) : undefined;

  // Opened directly (e.g. after a reload, before the list has loaded): fetch it instead.
  const [fetched, setFetched] = useState<EventRecord | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (listed || !valid) return;
    let cancelled = false;
    app.loadEvent(backendId).then(
      (stored) => !cancelled && setFetched(eventFromApi(stored)),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendId, !!listed]);

  const event = listed ?? fetched;
  const notFound = !valid || (!event && failed);

  return (
    <div style={{ padding: "24px 26px 34px", display: "flex", flexDirection: "column", gap: 18, maxWidth: 900 }}>
      <Link href="/my-events" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
        ← My events
      </Link>

      {notFound ? (
        <div className="card" style={{ padding: "18px 20px" }}>
          <div className="callout callout-danger">This event doesn't exist or isn't one of your requests.</div>
        </div>
      ) : !event ? (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Loading event…</div>
      ) : (
        <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>{event.name}</h2>
            <StatusPill status={event.status} />
            <span style={{ fontSize: 12, color: "var(--text-subtle)" }}>{event.id}</span>
          </div>
          <EventDetails event={event} />
          <StatusHistoryToggle event={event} />
        </div>
      )}
    </div>
  );
}
