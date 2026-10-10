"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { detailSections, lastUpdatedLabel } from "@/lib/events/details";
import type { StoredEvent } from "@/lib/events/request/api";
import { useApp } from "@/lib/state/app-context";
import type { EventRecord } from "@/lib/types";

type Load =
  | { state: "loading" }
  | { state: "ready"; event: StoredEvent }
  | { state: "error"; message: string };

/**
 * US15: the latest saved details of an event, as the signed-in role may see them.
 * Reloads the event from the server when shown, so it matches what other users see now;
 * fields the role may not see were left out by the server and are not shown at all.
 */
export function EventDetails({ event }: { event: EventRecord }) {
  const app = useApp();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const { backendId } = event;

  useEffect(() => {
    if (backendId === undefined) return;
    let cancelled = false;
    setLoad({ state: "loading" });
    app.loadEvent(backendId).then(
      (stored) => !cancelled && setLoad({ state: "ready", event: stored }),
      (err) =>
        !cancelled &&
        setLoad({
          state: "error",
          message:
            err instanceof ApiError && err.status === 403
              ? "You don't have permission to view this event."
              : err instanceof ApiError && err.status === 404
                ? "This event no longer exists."
                : "Couldn't load the event details. Please try again.",
        }),
    );
    return () => {
      cancelled = true;
    };
    // Reload when another view changes the event (its status or saved time moves on).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendId, event.status, event.updatedAt]);

  if (backendId === undefined) {
    return (
      <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
        No details yet: this event hasn't been saved to ConnectSphere.
      </div>
    );
  }
  if (load.state === "loading") {
    return <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Loading event details…</div>;
  }
  if (load.state === "error") {
    return <div className="callout callout-danger">{load.message}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="tabular" style={{ fontSize: 12, color: "var(--text-subtle)" }}>
        <time dateTime={load.event.updatedAt}>{lastUpdatedLabel(load.event)}</time>
      </div>
      {detailSections(load.event, app.equipName).map((section) => (
        <section key={section.title} aria-label={section.title}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            {section.title}
          </div>
          <dl style={{ display: "grid", gridTemplateColumns: "minmax(140px, max-content) 1fr", gap: "6px 16px", margin: 0 }}>
            {section.rows.map((row) => (
              <div key={row.label} style={{ display: "contents" }}>
                <dt style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{row.label}</dt>
                <dd style={{ fontSize: 13.5, margin: 0 }}>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** A "Details" button that shows the event's latest details underneath when opened. */
export function EventDetailsToggle({ event }: { event: EventRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide details" : "Details"}
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <EventDetails event={event} />
        </div>
      )}
    </div>
  );
}
