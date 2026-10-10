"use client";

import { useMemo, useState } from "react";
import { useApp } from "@/lib/state/app-context";
import type { RegistrationStatus } from "@/lib/types";

export default function RegistrationsPage() {
  const app = useApp();
  const [eventId, setEventId] = useState("");
  const [status, setStatus] = useState<RegistrationStatus | "all">("all");
  const managed = app.state.events.filter((event) => app.state.role === "coordinator" ? event.coordinator === app.me.person : event.organiser === app.me.person);
  const selected = managed.find((event) => event.id === eventId) ?? managed[0];
  const rows = useMemo(() => app.state.registrations.filter((r) => r.eventId === selected?.id && (status === "all" || r.status === status)), [app.state.registrations, selected?.id, status]);

  const exportCsv = () => {
    if (!selected) return;
    const csv = ["Name,Email,Status,Registered at", ...rows.map((r) => [r.attendeeName, r.attendeeEmail, r.status, r.registeredAt].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selected.id}-registrations.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!selected) return <div className="empty-state">You do not manage any events with registration access.</div>;
  return <div style={{ padding: "24px 26px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
    <div className="card" style={{ padding: 18, display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
      <label className="field" style={{ flex: 1, minWidth: 240 }}><span>Managed event</span><select className="select-input" value={selected.id} onChange={(e) => setEventId(e.target.value)}>{managed.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <label className="field"><span>Status</span><select className="select-input" value={status} onChange={(e) => setStatus(e.target.value as RegistrationStatus | "all")}><option value="all">All statuses</option><option value="registered">Registered</option><option value="waitlisted">Waitlisted</option><option value="withdrawn">Withdrawn</option><option value="cancelled">Cancelled</option></select></label>
      <button className="btn btn-primary" onClick={exportCsv}>Export CSV</button>
    </div>
    <div className="card" style={{ padding: 18 }}><strong>{selected.registered} / {selected.regCap} places filled</strong><span style={{ marginLeft: 16, color: "var(--text-muted)" }}>{rows.length} matching records</span></div>
    <div className="card" style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["Attendee", "Email", "Status", "Registered at"].map((h) => <th key={h} style={{ textAlign: "left", padding: 12, borderBottom: "1px solid var(--border)" }}>{h}</th>)}</tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td style={{ padding: 12 }}>{r.attendeeName}</td><td style={{ padding: 12 }}>{r.attendeeEmail}</td><td style={{ padding: 12, textTransform: "capitalize" }}>{r.status}</td><td style={{ padding: 12 }}>{new Date(r.registeredAt).toLocaleString()}</td></tr>)}</tbody></table>{rows.length === 0 && <div className="empty-state">No registrations match this filter.</div>}</div>
  </div>;
}
