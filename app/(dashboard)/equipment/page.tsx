"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { EquipmentRequestCard } from "@/components/equipment/EquipmentRequestCard";
import { useApp } from "@/lib/state/app-context";

type Request = { id: number; name: string; date: string; start: string; end: string };
export default function EquipmentPage() {
  const app = useApp();
  const [requests, setRequests] = useState<Request[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    apiFetch<Request[]>("/equipment/requests").then(setRequests).catch((err) => setError(err.message)).finally(() => setLoaded(true));
  }, []);
  const event = requests.find((r) => String(r.id) === selected) ?? requests[0];
  const record = app.state.events.find((row) => row.backendId === event?.id);
  return <div style={{ padding: 26, display: "grid", gap: 18 }}>
    <h1>Equipment requests</h1>
    {error && <p role="alert">{error}</p>}
    {!loaded ? <p>Loading requests…</p> : !event ? <p>No equipment requests are assigned to you.</p> : <>
      <label className="field">Assigned event<select className="select-input" aria-label="Assigned event" value={event.id} onChange={(e) => setSelected(e.target.value)}>{requests.map((request) => <option key={request.id} value={request.id}>{request.name}</option>)}</select></label>
      <p>{event.date} · {event.start}–{event.end}</p>
      {record && <EquipmentRequestCard key={event.id} event={record} />}
    </>}
  </div>;
}
