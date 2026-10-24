"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/lib/state/app-context";
import { apiFetch } from "@/lib/api/client";
import { EQUIP } from "@/lib/data/options";

type Line = { id: string; qty: number; technicalRequirements: string; status?: string; notes?: string; alternative?: string };
type Snapshot = {
  techId: number | null; editable: boolean; lines: Line[];
  availability: { id: string; name: string; total: number; maintenance: number; outOfService: number; available: number }[];
  history: { itemId: string | null; by: string; at: string; changes: { status?: string; qty?: number; notes?: string; alternative?: string; lines?: Line[]; techId?: number } }[];
};

/** Coordinator entry (US25) and assigned technician processing (US26–28). */
export function EquipmentManager({ eventId, coordinator = false }: { eventId: number; coordinator?: boolean }) {
  const app = useApp();
  const [data, setData] = useState<Snapshot | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [techId, setTechId] = useState("");
  const [techs, setTechs] = useState<{ id: number; name: string }[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const endpoint = `/events/${eventId}/equipment`;
  function accept(saved: Snapshot) {
    setData(saved); setLines(saved.lines); setTechId(saved.techId ? String(saved.techId) : "");
  }
  useEffect(() => {
    let active = true;
    setData(null); setMessage("");
    Promise.all([apiFetch<Snapshot>(endpoint), coordinator ? apiFetch<{ id: number; name: string }[]>("/equipment/technicians") : Promise.resolve([])])
      .then(([saved, technicians]) => { if (active) { accept(saved); setTechs(technicians); } })
      .catch((err) => { if (active) setMessage(err.message); });
    return () => { active = false; };
  }, [endpoint, coordinator]);
  async function persist(path: string, method: string, body?: unknown) {
    setBusy(true); setMessage("");
    try {
      accept(await apiFetch<Snapshot>(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }));
      await app.reloadEvents();
      setMessage(method === "GET" ? "Availability refreshed." : "Equipment saved.");
    } catch (err) { setMessage(err instanceof Error ? err.message : "Could not save equipment."); }
    finally { setBusy(false); }
  }
  function change(index: number, values: Partial<Line>) {
    setLines((current) => current.map((line, i) => i === index ? { ...line, ...values } : line));
  }
  if (!data) return <div role="status">{message || "Loading equipment…"}</div>;
  return <section style={{ display: "grid", gap: 16 }} aria-label="Equipment request">
    <p>Record equipment and assign Technical Support. Availability is checked for this event’s date and time.</p>
    {message && <div role="status" className="callout">{message}</div>}
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 14 }}>
      {coordinator && <label className="field">Assigned technician
        <select className="select-input" aria-label="Assigned technician" value={techId} disabled={!data.editable} onChange={(e) => setTechId(e.target.value)}>
          <option value="">Choose a technician</option>{techs.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}
        </select>
      </label>}
      {lines.map((line, index) => {
        const stock = data.availability.find((s) => s.id === line.id);
        const locked = line.status === "fulfilled" || (coordinator && (line.status === "reserved" || !data.editable));
        const shortfall = Math.max(0, line.qty - (stock?.available ?? 0));
        return <div key={index} className="card" style={{ padding: 16, display: "grid", gap: 10 }} aria-label={`Equipment line ${index + 1}`}>
          <label className="field">Equipment type
            <select className="select-input" aria-label={`Equipment type ${index + 1}`} value={line.id} disabled={!coordinator || locked} onChange={(e) => change(index, { id: e.target.value })}>
              {EQUIP.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="field">Quantity
            <input className="text-input" aria-label={`Quantity ${index + 1}`} type="number" min="1" step="1" value={line.qty || ""} disabled={locked} onChange={(e) => change(index, { qty: Number(e.target.value) })} />
          </label>
          <label className="field">Technical requirements
            <input className="text-input" aria-label={`Technical requirements ${index + 1}`} value={line.technicalRequirements} disabled={!coordinator || locked} onChange={(e) => change(index, { technicalRequirements: e.target.value })} />
          </label>
          <div>Current status: <strong>{data.lines[index]?.status ?? "pending"}</strong></div>
          <div>{stock?.available ?? 0} available of {stock?.total ?? 0} · {stock?.maintenance ?? 0} under maintenance · {stock?.outOfService ?? 0} out of service{shortfall > 0 && <strong> · Shortfall: {shortfall}</strong>}</div>
          {coordinator ? <>
            {(line.notes || line.alternative) && <p>Technician: {line.notes} {line.alternative && `Alternative: ${line.alternative}`}</p>}
            <button className="btn btn-ghost" disabled={locked} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>Remove line {index + 1}</button>
          </> : <>
            <label className="field">Status
              <select className="select-input" aria-label={`Status ${index + 1}`} disabled={locked} value={line.status ?? "pending"} onChange={(e) => change(index, { status: e.target.value })}>
                <option value="pending">Pending</option><option value="reserved">Reserved</option><option value="unavailable">Unavailable</option><option value="fulfilled">Fulfilled</option>
              </select>
            </label>
            <label className="field">Notes<input className="text-input" aria-label={`Notes ${index + 1}`} value={line.notes ?? ""} disabled={locked} onChange={(e) => change(index, { notes: e.target.value })} /></label>
            <label className="field">Proposed alternative<input className="text-input" aria-label={`Alternative ${index + 1}`} value={line.alternative ?? ""} disabled={locked} onChange={(e) => change(index, { alternative: e.target.value })} /></label>
            <button className="btn btn-primary" disabled={locked} onClick={() => void persist(`${endpoint}/${line.id}`, "PATCH", { status: line.status ?? "pending", quantity: line.qty, notes: line.notes ?? "", alternative: line.alternative ?? "" })}>Save line {index + 1}</button>
            <p>Choose Pending to release a reservation. Fulfilled items cannot be amended.</p>
          </>}
        </div>;
      })}
      {coordinator && <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-ghost" disabled={!data.editable || lines.length >= EQUIP.length} onClick={() => { const next = EQUIP.find((item) => !lines.some((line) => line.id === item.id)); if (next) setLines([...lines, { id: next.id, qty: 1, technicalRequirements: "", status: "pending" }]); }}>Add equipment</button>
        <button className="btn btn-primary" disabled={!data.editable || !techId} onClick={() => void persist(endpoint, "PUT", { techId: Number(techId), lines: lines.map(({ id, qty, technicalRequirements }) => ({ id, qty, technicalRequirements })) })}>Submit equipment request</button>
      </div>}
      <button className="btn btn-ghost" onClick={() => void persist(endpoint, "GET")}>Refresh availability</button>
    </fieldset>
    <details><summary>Equipment update history</summary>{data.history.map((entry, i) => <p key={i}>{entry.by} · <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>{entry.itemId && ` · ${EQUIP.find((item) => item.id === entry.itemId)?.name}`}<br />{entry.changes.lines ? `Request saved (${entry.changes.lines.length} equipment lines)` : `${entry.changes.status ?? "Updated"} · Quantity: ${entry.changes.qty ?? "—"}${entry.changes.notes ? ` · ${entry.changes.notes}` : ""}${entry.changes.alternative ? ` · Alternative: ${entry.changes.alternative}` : ""}`}</p>)}</details>
  </section>;
}
