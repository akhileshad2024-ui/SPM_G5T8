"use client";
import { EQUIP } from "@/lib/data/options";
import type { EventDetailsUpdate } from "@/lib/types";

export function ReviewedValues({ value, onChange }: { value: EventDetailsUpdate; onChange: (value: EventDetailsUpdate) => void }) {
  function field(key: keyof EventDetailsUpdate, input: unknown) {
    const next = { ...value };
    if (input === "") delete next[key];
    else Object.assign(next, { [key]: input });
    onChange(next);
  }
  return <details style={{ margin: "12px 0" }}>
    <summary>Reviewed values for reassessment (optional)</summary>
    <p>Enter only agreed changes. Accepting checks arrangements against these values and retains the current event details. Applying them is a separate action.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
      {([["date", "Date", "date"], ["start", "Start", "time"], ["end", "End", "time"],
         ["pax", "Expected attendance", "number"], ["regCap", "Registration capacity", "number"],
         ["regClose", "Registration closing date", "date"], ["venueLocation", "Venue location", "text"]] as const).map(([key, label, type]) =>
        <label key={key}>Reviewed {label.toLowerCase()}
          <input className="text-input" aria-label={`Reviewed ${label.toLowerCase()}`} type={type} min={type === "number" ? 1 : undefined}
            value={(value[key] as string | number | undefined) ?? ""} onChange={e => field(key, e.target.value === "" ? "" : type === "number" ? Number(e.target.value) : e.target.value)} />
        </label>)}
      <label>Reviewed registration
        <select aria-label="Reviewed registration" value={value.reg === undefined ? "" : String(value.reg)} onChange={e => field("reg", e.target.value === "" ? "" : e.target.value === "true")}>
          <option value="">Keep existing</option><option value="true">Enabled</option><option value="false">Disabled</option>
        </select>
      </label>
    </div>
    <label><input type="checkbox" checked={value.equip !== undefined} onChange={e => {
      const next = { ...value }; if (e.target.checked) next.equip = []; else delete next.equip; onChange(next);
    }} />Replace equipment requirements for review</label>
    {value.equip !== undefined && EQUIP.map(item => {
      const line = value.equip!.find(line => line.id === item.id);
      return <div key={item.id}>
        <label>{item.name} reviewed quantity<input aria-label={`${item.name} reviewed quantity`} type="number" min={0} value={line?.qty ?? 0}
          onChange={e => { const qty = Number(e.target.value); onChange({ ...value, equip: [...value.equip!.filter(line => line.id !== item.id), ...(qty > 0 ? [{id: item.id, qty, technicalRequirements: line?.technicalRequirements ?? ""}] : [])] }); }} /></label>
        {line && <label>Reviewed technical requirements for {item.name}<input value={line.technicalRequirements ?? ""}
          onChange={e => onChange({ ...value, equip: value.equip!.map(row => row.id === item.id ? {...row, technicalRequirements: e.target.value} : row) })} /></label>}
      </div>;
    })}
  </details>;
}
