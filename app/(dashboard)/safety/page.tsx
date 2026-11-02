"use client";

import { useApp } from "@/lib/state/app-context";
import { SafetyCheckCard } from "@/components/safety/SafetyCheckCard";
import { awaitingChecks, decidedChecks } from "@/lib/safety/checks";

/**
 * US44: the Safety Officer's page. The events whose venue and technical arrangements are confirmed and that
 * wait for an Operational Safety Check, with what to review for each, and the events already decided.
 * The server decides what the officer may see (backend/event_access.py) and records every decision.
 */
export default function SafetyPage() {
  const app = useApp();
  const awaiting = awaitingChecks(app.state.safetyChecks);
  const decided = decidedChecks(app.state.safetyChecks);

  return (
    <div style={{ padding: "24px 26px 34px", display: "flex", flexDirection: "column", gap: 22 }}>
      <section aria-label="Awaiting a safety check" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="section-heading">Awaiting a safety check ({awaiting.length})</div>
        {awaiting.map((check) => <SafetyCheckCard key={check.eventId} check={check} />)}
        {awaiting.length === 0 && (
          <div className="card" style={{ padding: 32, textAlign: "center", fontSize: 13, color: "var(--text-subtle)" }}>
            No events are waiting for a safety check.
          </div>
        )}
      </section>

      <section aria-label="Already reviewed" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="section-heading">Already reviewed ({decided.length})</div>
        {decided.map((check) => <SafetyCheckCard key={check.eventId} check={check} />)}
        {decided.length === 0 && (
          <div className="card" style={{ padding: 32, textAlign: "center", fontSize: 13, color: "var(--text-subtle)" }}>
            Nothing has been reviewed yet.
          </div>
        )}
      </section>
    </div>
  );
}
