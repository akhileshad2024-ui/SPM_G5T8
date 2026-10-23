"use client";

import { useRef, useState } from "react";
import { useApp } from "@/lib/state/app-context";
import { ACCESS_OPTIONS, EQUIP, FACILITY_OPTIONS, LAYOUT_OPTIONS } from "@/lib/data/options";
import type { EventDetailsUpdate, EventRecord } from "@/lib/types";

const TEXT_FIELDS = [
  ["name", "Event name", "text"], ["eventType", "Event type", "text"],
  ["pax", "Expected attendance", "number"], ["date", "Proposed date", "date"],
  ["start", "Start", "time"], ["end", "End", "time"],
  ["venueLocation", "Preferred venue location", "text"], ["venueCapacity", "Required capacity", "number"],
  ["regCap", "Registration capacity", "number"], ["regClose", "Registration closing date", "date"],
] as const;

/** US16: small partial editor, not the organiser draft wizard or US34 impact review. */
export function EventDetailsEditor({ event }: { event: EventRecord }) {
  const app = useApp();
  const [initial, setInitial] = useState<EventDetailsUpdate | null>(null);
  const [values, setValues] = useState<EventDetailsUpdate>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const allowed = app.state.role === "coordinator" && event.coordinator === app.me.person
    && ["submitted", "under_review", "pending_clarification", "approved"].includes(event.status);
  if (!allowed || event.backendId === undefined) return null;

  async function open() {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setError("");
    try {
      const saved = await app.loadEvent(event.backendId!);
      // Take only detail fields from the latest API view, never actor/status fields.
      const data: EventDetailsUpdate = {};
      for (const key of ["purpose", "layout", "facilities", "access", "equip", "reg", ...TEXT_FIELDS.map(([key]) => key)] as const) {
        Object.assign(data, { [key]: saved[key] });
      }
      setInitial(data); setValues(data);
    } catch { setError("Could not load event details. Please try again."); }
    finally { pending.current = false; setLoading(false); }
  }

  // Send changed fields only. Another page's unrelated changes are not overwritten.
  const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) =>
    JSON.stringify(value) !== JSON.stringify(initial?.[key as keyof EventDetailsUpdate]))) as EventDetailsUpdate;
  const hasChanges = Object.keys(changes).length > 0;
  const arranged = !!(event.venue || event.bookingState || event.equipState || event.registered);
  const affects = hasChanges && (arranged || Object.keys(changes).some((key) => !["name", "purpose", "eventType"].includes(key)));
  const set = (key: keyof EventDetailsUpdate, value: unknown) => setValues((old) => ({ ...old, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pending.current || !hasChanges) return;
    pending.current = true; setSaving(true);
    try {
      if (await app.saveEventDetails(event.backendId!, changes)) setInitial(null);
    } finally { pending.current = false; setSaving(false); }
  }

  return <section aria-label="Edit event details" className="card" style={{ padding: 20, marginTop: 12 }}>
    {!initial ? <button className="btn btn-ghost" onClick={() => void open()} disabled={loading}>
      {loading ? "Loading…" : "Edit event details"}
    </button> : <form onSubmit={(e) => void save(e)}>
      <h3>Edit event details</h3>
      <fieldset disabled={saving} style={{ border: 0, padding: 0 }}>
        <div className="field"><label htmlFor="detail-purpose">Purpose and description</label>
          <textarea id="detail-purpose" className="text-input" value={values.purpose ?? ""} onChange={(e) => set("purpose", e.target.value)} /></div>
        {TEXT_FIELDS.map(([key, label, type]) => <div className="field" key={key}>
          <label htmlFor={`detail-${key}`}>{label}</label>
          <input id={`detail-${key}`} className="text-input" type={type} min={type === "number" ? 1 : undefined}
            value={values[key] ?? ""} onChange={(e) => set(key, type === "number"
              ? e.target.value === "" ? null : Number(e.target.value)
              : e.target.value === "" && !["name", "eventType", "venueLocation"].includes(key) ? null : e.target.value)} />
        </div>)}
        <div className="field"><label htmlFor="detail-layout">Layout</label>
          <select id="detail-layout" className="select-input" value={values.layout ?? ""} onChange={(e) => set("layout", e.target.value || null)}>
            <option value="">No preference</option>{LAYOUT_OPTIONS.map((value) => <option key={value}>{value}</option>)}
          </select></div>
        {([['facilities', 'Facilities', FACILITY_OPTIONS], ['access', 'Accessibility', ACCESS_OPTIONS]] as const).map(([key, label, options]) =>
          <fieldset key={key}><legend>{label}</legend>{options.map((value) => <label key={value} style={{ display: "block" }}>
            <input type="checkbox" checked={values[key]?.includes(value) ?? false} onChange={(e) =>
              set(key, e.target.checked ? [...(values[key] ?? []), value] : values[key]?.filter((item) => item !== value))} /> {value}
          </label>)}</fieldset>)}
        <fieldset><legend>Equipment needs</legend>{EQUIP.map((item) => {
          const line = values.equip?.find((row) => row.id === item.id);
          return <div key={item.id} className="field">
            <label htmlFor={`detail-${item.id}`}>{item.name} quantity</label>
            <input id={`detail-${item.id}`} type="number" min={0} className="text-input" value={line?.qty ?? 0} onChange={(e) => {
              const rest = values.equip?.filter((row) => row.id !== item.id) ?? [];
              const qty = Number(e.target.value);
              set("equip", qty > 0 ? [...rest, { id: item.id, qty, technicalRequirements: line?.technicalRequirements ?? "" }] : rest);
            }} />
            {line && <><label htmlFor={`detail-${item.id}-technical`}>{item.name} technical requirements</label>
              <input id={`detail-${item.id}-technical`} className="text-input" value={line.technicalRequirements ?? ""} onChange={(e) =>
                set("equip", values.equip?.map((row) => row.id === item.id ? { ...row, technicalRequirements: e.target.value } : row))} /></>}
          </div>;
        })}</fieldset>
        <label><input type="checkbox" checked={values.reg ?? false} onChange={(e) => set("reg", e.target.checked)} /> Enable attendee registration</label>
        <p role="status">{!hasChanges ? "No changes." : affects
          ? "May affect existing arrangements. Review may be needed; arrangements are not automatically changed."
          : "Ordinary edit: no existing arrangements are recorded."}</p>
        <button className="btn btn-primary" type="submit" disabled={!hasChanges}>{saving ? "Saving…" : "Save changes"}</button>
        <button className="btn btn-ghost" type="button" onClick={() => setInitial(null)}>Cancel</button>
      </fieldset>
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
