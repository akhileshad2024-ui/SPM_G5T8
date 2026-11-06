"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { useApp } from "@/lib/state/app-context";

type Flag = { id: number; targetType: string; targetId: number; source: string; sourceId: number;
  reason: string; status: string; resolution: string | null; resolvedAt: string | null };
type Summary = { flags: Flag[]; planningStage: string | null; canPrepare: boolean; preparedAt: string | null; preparationIssues: string[] };

export function ReassessmentPanel({ eventId, kind, preparation = false, heading = "Arrangement reassessment" }: { eventId: number; kind?: string; preparation?: boolean; heading?: string }) {
  const app = useApp();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Set at once, so two clicks before React redraws the disabled button still send one request.
  const working = useRef(false);
  const stored = app.state.events.find(event => event.backendId === eventId);
  const revision = `${stored?.status ?? ""}:${stored?.updatedAt ?? ""}`;
  async function reload() { setSummary(await apiFetch<Summary>(`/events/${eventId}/reassessments`)); }
  useEffect(() => {
    let live = true;
    const load = () => { apiFetch<Summary>(`/events/${eventId}/reassessments`).then(s => { if (live) setSummary(s); }, e => { if (live) setError(e.message); }); };
    load();
    window.addEventListener("arrangements-changed", load);
    return () => { live = false; window.removeEventListener("arrangements-changed", load); };
  }, [eventId, revision]);
  async function act(path: string, body?: object) {
    if (working.current) return;
    working.current = true;
    setBusy(true); setError("");
    try { await apiFetch(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save. Refresh to check the current state."); }
    finally { working.current = false; setBusy(false); }
  }
  if (!summary && !error) return null;
  const flags = summary?.flags.filter(flag => !kind || flag.targetType === kind) ?? [];
  const coordinator = app.state.role === "coordinator";
  if (!flags.length && !preparation && !error) return null;
  return <section className="card" aria-label={kind ? `${kind} reassessments` : "Arrangement reassessments"} style={{ padding: 18, marginBottom: 16 }}>
    <h3>{heading}</h3>
    {summary?.planningStage && <p>Returned to {summary.planningStage.replaceAll("_", " ")}.</p>}
    {error && <p role="alert">{error}</p>}
    {!flags.length && <p>No reassessment flags recorded.</p>}
    {flags.map(flag => {
      const responsible = flag.targetType === "equipment" ? app.state.role === "tech" : coordinator || (flag.targetType === "venue" && app.state.role === "venue");
      return <article key={flag.id} aria-label={`${flag.targetType} ${flag.targetId} reassessment`} style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}>
        <strong>{flag.targetType} #{flag.targetId} — {flag.status}</strong>
        <p>{flag.reason}</p>
        <p>{flag.source.replaceAll("_", " ")} #{flag.sourceId}</p>
        {flag.resolvedAt ? <p>Resolved: {flag.resolution}</p> : responsible && <>
          <label htmlFor={`resolution-${flag.id}`}>Resolution evidence</label>
          <input id={`resolution-${flag.id}`} className="text-input" value={notes[flag.id] ?? ""}
            onChange={e => setNotes(old => ({ ...old, [flag.id]: e.target.value }))} />
          <button className="btn btn-ghost" disabled={busy || !notes[flag.id]?.trim()}
            onClick={() => void act(`/events/${eventId}/reassessments/${flag.id}/resolve`, { note: notes[flag.id] })}>Resolve reassessment #{flag.id}</button>
        </>}
      </article>;
    })}
    {preparation && coordinator && <div>
      <h3>Preparation</h3>
      {summary?.preparedAt ? <p>Preparation started {new Date(summary.preparedAt).toLocaleString()}.</p> : <>
        {summary?.preparationIssues.map(issue => <p key={issue}>{issue}</p>)}
        <button className="btn btn-primary" disabled={busy || !summary?.canPrepare}
          onClick={() => void act(`/events/${eventId}/preparation`)}>Start preparation</button>
      </>}
    </div>}
  </section>;
}
