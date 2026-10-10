"use client";

import { useApp } from "@/lib/state/app-context";
import { localDateISO } from "@/lib/events/request/validation";

export function StepBasics() {
  const app = useApp();
  const { form, formErrors } = app.state;

  const error = (field: string) =>
    formErrors[field] ? <div className="error-text">{formErrors[field]}</div> : null;

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
        {error("name")}
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
        {error("description")}
      </div>

      <div className="field">
        <label className="eyebrow">Event type</label>
        <select
          className="text-input"
          value={form.eventType}
          onChange={(e) => app.setFormField("eventType", e.target.value)}
        >
          <option value="">Select an event type</option>
          <option value="conference">Conference</option>
          <option value="workshop">Workshop</option>
          <option value="networking">Networking</option>
          <option value="ceremony">Ceremony</option>
          <option value="other">Other</option>
        </select>
        {error("eventType")}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
        <div className="field">
          <label className="eyebrow">Proposed date</label>
          <input
            className="text-input"
            type="date"
            min={localDateISO(new Date())}
            value={form.date}
            onChange={(e) => app.setFormField("date", e.target.value)}
          />
          {error("preferredDate")}
        </div>
        <div className="field">
          <label className="eyebrow">Start</label>
          <input
            className="text-input"
            type="time"
            value={form.start}
            onChange={(e) => app.setFormField("start", e.target.value)}
          />
          {error("startTime")}
        </div>
        <div className="field">
          <label className="eyebrow">End</label>
          <input
            className="text-input"
            type="time"
            value={form.end}
            onChange={(e) => app.setFormField("end", e.target.value)}
          />
          {error("endTime")}
        </div>
        <div className="field">
          <label className="eyebrow">Expected attendance</label>
          <input
            className="text-input tabular"
            type="number"
            min="1"
            step="1"
            value={form.pax}
            onChange={(e) => app.setFormField("pax", e.target.value)}
            placeholder="180"
          />
          {error("expectedAttendance")}
        </div>
      </div>
    </div>
  );
}
