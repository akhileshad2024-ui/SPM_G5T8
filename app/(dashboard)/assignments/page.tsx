"use client";

import { useState } from "react";
import { useApp } from "@/lib/state/app-context";
import { attendanceLabel } from "@/lib/events/details";
import { coordinatorWorkloads, unassignedRequests } from "@/lib/events/review/lead";
import { StatusPill } from "@/components/ui/Pill";
import { EventDetailsToggle } from "@/components/ui/EventDetails";
import type { EventRecord } from "@/lib/types";

/**
 * US43 / US11: the Event Coordinator Lead's page. The unassigned queue (each request's basic information,
 * and assigning a coordinator to it), and each coordinator's current assignments. The server decides what
 * the Lead may see (backend/event_access.py) and who may assign (POST /events/{id}/assign).
 */
function UnassignedRequest({ event }: { event: EventRecord }) {
  const app = useApp();
  const coordinators = app.state.coordinators.map((c) => c.name);
  const [choice, setChoice] = useState("");

  return (
    <div className="card" style={{ padding: "16px 20px" }} aria-label={`Unassigned request: ${event.name}`}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 15.5, fontWeight: 700 }}>{event.name}</span>
            <StatusPill status={event.status} />
          </div>
          <div className="tabular" style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 6 }}>
            {event.id} · {event.organiser} · {event.date}
            {event.start ? `, ${event.start}–${event.end}` : ""} · {attendanceLabel(event.pax, "expected")}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 4 }}>{event.purpose}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select className="select-input" aria-label="Coordinator to assign" value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Choose a coordinator…</option>
            {coordinators.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" disabled={!choice} onClick={() => app.assignCoordinator(event.id, choice)}>
            Assign
          </button>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <EventDetailsToggle event={event} />
      </div>
    </div>
  );
}

export default function AssignmentsPage() {
  const app = useApp();
  const unassigned = unassignedRequests(app.state.events);
  const byCoordinator = coordinatorWorkloads(app.state.events, app.state.coordinators);

  return (
    <div style={{ padding: "24px 26px 34px", display: "flex", flexDirection: "column", gap: 22 }}>
      <section aria-label="Unassigned requests" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="section-heading">Unassigned requests ({unassigned.length})</div>
        {unassigned.map((e) => <UnassignedRequest key={e.id} event={e} />)}
        {unassigned.length === 0 && (
          <div className="card" style={{ padding: 32, textAlign: "center", fontSize: 13, color: "var(--text-subtle)" }}>
            Every request has a coordinator.
          </div>
        )}
      </section>

      <section aria-label="Coordinators" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="section-heading">Coordinators</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          {byCoordinator.map(({ name, events }) => (
            <div key={name} className="card" style={{ padding: "14px 18px" }} aria-label={`Coordinator: ${name}`}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <strong>{name}</strong>
                <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{events.length} active</span>
              </div>
              <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
                {events.map((e) => (
                  <li key={e.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{e.name}</span>
                    <span className="tabular" style={{ fontSize: 12, color: "var(--text-muted)" }}>{e.date}</span>
                    <StatusPill status={e.status} />
                  </li>
                ))}
                {events.length === 0 && <li style={{ fontSize: 12.5, color: "var(--text-subtle)", padding: "6px 0" }}>No active events.</li>}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
