"use client";

import { useApp } from "@/lib/state/app-context";
import { localDateISO } from "@/lib/events/request/validation";

export function StepRegistration() {
  const app = useApp();
  const { form, formErrors } = app.state;

  const summary: Array<[string, string]> = [
    ["Event", form.name.trim() || "—"],
    ["Type", form.eventType || "—"],
    ["When", `${form.date || "—"} · ${form.start}–${form.end}`],
    ["Attendance", form.pax || "—"],
    ["Venue", `${form.venueLocation || "—"} · capacity ${form.venueCapacity || "—"}`],
    ["Layout", form.layout.charAt(0).toUpperCase() + form.layout.slice(1)],
    ["Facilities", form.facilities.join(", ") || "None"],
    ["Accessibility", form.access.join(", ") || "None"],
    [
      "Equipment",
      Object.keys(form.equip)
        .filter((k) => form.equip[k] > 0)
        .map((k) => `${form.equip[k]} × ${app.equipName(k)}`)
        .join(", ") || "None",
    ],
    ["Registration", form.reg ? `Enabled · cap ${form.regCap}` : "Not enabled"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 11,
          padding: "15px 16px",
          border: "1px solid rgba(10,14,26,.10)",
          borderRadius: 4,
          cursor: "pointer",
          background: "#FAFAFB",
        }}
      >
        <input
          type="checkbox"
          checked={form.reg}
          onChange={() => app.setFormField("reg", !form.reg)}
          style={{ width: 16, height: 16, marginTop: 2, accentColor: "var(--blue)" }}
        />
        <span>
          <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>Enable attendee registration</span>
          <span style={{ display: "block", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55, marginTop: 3 }}>
            Attendees will be able to view this event, register, and withdraw. You and your coordinator will see the
            registration list.
          </span>
        </span>
      </label>

      {form.reg && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
          <div className="field">
            <label className="eyebrow">Registration cap</label>
            <input
              className="text-input tabular"
              type="number"
              min="1"
              step="1"
              value={form.regCap}
              onChange={(e) => app.setFormField("regCap", e.target.value)}
            />
            {formErrors["registration.capacityLimit"] && (
              <div className="error-text">{formErrors["registration.capacityLimit"]}</div>
            )}
          </div>
          <div className="field">
            <label className="eyebrow">Registration closes</label>
            <input
              className="text-input"
              type="date"
              min={localDateISO(new Date())}
              max={form.date || undefined}
              value={form.regClose}
              onChange={(e) => app.setFormField("regClose", e.target.value)}
            />
            {formErrors["registration.closingDate"] && (
              <div className="error-text">{formErrors["registration.closingDate"]}</div>
            )}
          </div>
        </div>
      )}

      <div style={{ height: 1, background: "var(--border)" }} />

      <div>
        <div className="section-heading" style={{ marginBottom: 12 }}>
          Summary
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "14px 22px" }}>
          {summary.map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-faint)" }}>
                {k}
              </div>
              <div className="tabular" style={{ fontSize: 13.5, marginTop: 4 }}>
                {v}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
