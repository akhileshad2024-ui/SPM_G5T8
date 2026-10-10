"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api/client";
import {
  describeChange,
  fetchStatusHistory,
  formatChangedAt,
  newestFirst,
  type StatusChange,
} from "@/lib/events/status-history";
import type { EventRecord } from "@/lib/types";
import { StatusPill } from "./Pill";

type Load =
  | { state: "loading" }
  | { state: "ready"; history: StatusChange[] }
  | { state: "error"; message: string };

/**
 * US13: an event's current status and its timestamped history of status changes.
 * The history comes from the server, so an event not saved there yet has none.
 */
export function StatusHistory({ event }: { event: EventRecord }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const { backendId } = event;

  useEffect(() => {
    if (backendId === undefined) return;
    let cancelled = false;
    setLoad({ state: "loading" });
    fetchStatusHistory(backendId).then(
      (history) => !cancelled && setLoad({ state: "ready", history }),
      (err) =>
        !cancelled &&
        setLoad({
          state: "error",
          message:
            err instanceof ApiError && err.status === 403
              ? "You don't have permission to view this event's status history."
              : "Couldn't load the status history. Please try again.",
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [backendId, event.status]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="eyebrow">Current status</span>
        <StatusPill status={event.status} />
      </div>

      {backendId === undefined ? (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          No status history yet: this event hasn't been saved to ConnectSphere.
        </div>
      ) : load.state === "loading" ? (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Loading status history…</div>
      ) : load.state === "error" ? (
        <div className="callout callout-danger">{load.message}</div>
      ) : (
        <ol aria-label="Status history" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {newestFirst(load.history).map((change, i) => (
            <li key={`${change.changedAt}-${i}`} style={{ display: "flex", gap: 12, paddingBottom: 12 }}>
              <span
                className="dot"
                style={{ width: 8, height: 8, marginTop: 6, flex: "none", background: i === 0 ? "var(--blue)" : "#C9CEDD" }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{describeChange(change)}</div>
                <div className="tabular" style={{ fontSize: 11.5, color: "var(--text-subtle)", marginTop: 2 }}>
                  <time dateTime={change.changedAt}>{formatChangedAt(change.changedAt)}</time>
                  {change.changedBy ? ` · ${change.changedBy}` : ""}
                </div>
                {change.reason && (
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 }}>Reason: {change.reason}</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** A "Status history" button that shows the timeline underneath when opened. */
export function StatusHistoryToggle({ event }: { event: EventRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide status history" : "Status history"}
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <StatusHistory event={event} />
        </div>
      )}
    </div>
  );
}
