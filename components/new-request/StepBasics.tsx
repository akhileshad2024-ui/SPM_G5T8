"use client";

import { useApp } from "@/lib/app-context";

export function StepBasics() {
  const app = useApp();
  const { form, errName } = app.state;
  const showError = errName && !form.name.trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="field">
        <label className="eyebrow">Event name</label>
        <input
          className="text-input"
          style={{ fontSize: 15 }}
          value={form.name}
          onChange={(e) => app.setFormField("name", e.target.value)}
          placeholder="Alumni Homecoming Dinner"
        />
        {showError && <div className="error-text">An event name is required before submission.</div>}
      </div>

      <div className="field">
        <label className="eyebrow">Purpose and description</label>
        <textarea
          className="textarea-input"
          rows={4}
          value={form.purpose}
          onChange={(e) => app.setFormField("purpose", e.target.value)}
          placeholder="What is this event for, and who is it for?"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
        <div className="field">
          <label className="eyebrow">Proposed date</label>
          <input
            className="text-input"
            type="date"
            value={form.date}
            onChange={(e) => app.setFormField("date", e.target.value)}
          />
        </div>
        <div className="field">
          <label className="eyebrow">Start</label>
          <input
            className="text-input"
            type="time"
            value={form.start}
            onChange={(e) => app.setFormField("start", e.target.value)}
          />
        </div>
        <div className="field">
          <label className="eyebrow">End</label>
          <input
            className="text-input"
            type="time"
            value={form.end}
            onChange={(e) => app.setFormField("end", e.target.value)}
          />
        </div>
        <div className="field">
          <label className="eyebrow">Expected attendance</label>
          <input
            className="text-input tabular"
            value={form.pax}
            onChange={(e) => app.setFormField("pax", e.target.value)}
            placeholder="180"
          />
        </div>
      </div>
    </div>
  );
}
