import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import type { Venue } from "@/lib/types";

const LAYOUT_OPTIONS = ["U-Shape", "Boardroom", "Classroom", "Theatre", "Banquet", "Standing"];
const FACILITY_OPTIONS = ["Projector", "Whiteboard", "Microphone", "Sound System", "Video Conferencing", "Wi-Fi"];
const ACCESSIBILITY_OPTIONS = ["Wheelchair Access", "Special Physical Seating", "Mobility/Facility Arrangements"];
const DAY_OPTIONS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function VenueForm({ 
  initialData, 
  onSuccess, 
  onCancel 
}: { 
  initialData?: Venue | null; 
  onSuccess: () => void; 
  onCancel: () => void; 
}) {
  const app = useApp();
  const [formData, setFormData] = useState({
    name: initialData?.name || "",
    building: initialData?.building || "",
    cap: initialData?.cap || 0,
    layouts: initialData?.layouts || [],
    facilities: initialData?.facilities || [],
    accessibility: initialData?.accessibility || [],
    operatingHours: initialData?.operatingHours || "08:00 - 22:00",
    unavailableDates: initialData?.unavailableDates || [],
    operatingDays: initialData?.operatingDays || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  });

  const [newDate, setNewDate] = useState("");

  const times = formData.operatingHours ? formData.operatingHours.split(" - ") : ["08:00", "22:00"];
  const startHour = times[0] || "08:00";
  const endHour = times[1] || "22:00";

  const handleTimeChange = (type: "start" | "end", value: string) => {
    const s = type === "start" ? value : startHour;
    const e = type === "end" ? value : endHour;
    setFormData({ ...formData, operatingHours: `${s} - ${e}` });
  };

  const toggleArrayItem = (field: "layouts" | "facilities" | "accessibility", item: string) => {
    setFormData((prev) => {
      const arr = prev[field];
      return arr.includes(item) 
        ? { ...prev, [field]: arr.filter((i) => i !== item) }
        : { ...prev, [field]: [...arr, item] };
    });
  };

  const addDate = (e: React.MouseEvent) => {
    e.preventDefault();
    if (newDate && !formData.unavailableDates.includes(newDate)) {
      setFormData({ ...formData, unavailableDates: [...formData.unavailableDates, newDate] });
      setNewDate("");
    }
  };

  const removeDate = (dateToRemove: string) => {
    setFormData({ ...formData, unavailableDates: formData.unavailableDates.filter(d => d !== dateToRemove) });
  };

  const handleSave = async () => {
    const path = initialData?.id ? `/venues/${initialData.id}` : "/venues";
    const method = initialData?.id ? "PUT" : "POST";

    try {
      await apiFetch(path, { method, body: JSON.stringify(formData) });
      onSuccess();
    } catch (err) {
      app.handleApiError(err);
    }
  };

  const CheckboxGroup = ({ title, options, field }: { title: string, options: string[], field: "layouts" | "facilities" | "accessibility" }) => (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {options.map((opt) => (
          <label key={opt} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
            <input 
              type="checkbox" 
              checked={formData[field].includes(opt)} 
              onChange={() => toggleArrayItem(field, opt)} 
            />
            {opt}
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 16, fontWeight: 700 }}>
        {initialData ? "Edit Venue" : "Add Venue"}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input placeholder="Venue Name" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} style={{ padding: 8, border: "1px solid var(--border)", width: "100%", boxSizing: "border-box" }} />
        <input placeholder="Building" value={formData.building} onChange={(e) => setFormData({...formData, building: e.target.value})} style={{ padding: 8, border: "1px solid var(--border)", width: "100%", boxSizing: "border-box" }} />
        <input placeholder="Capacity" type="number" value={formData.cap || ""} onChange={(e) => setFormData({...formData, cap: parseInt(e.target.value) || 0})} style={{ padding: 8, border: "1px solid var(--border)", width: "100%", boxSizing: "border-box" }} />
      </div>

      <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />

      <CheckboxGroup title="Supported Layouts" options={LAYOUT_OPTIONS} field="layouts" />
      <CheckboxGroup title="Included Facilities" options={FACILITY_OPTIONS} field="facilities" />
      <CheckboxGroup title="Accessibility Needs" options={ACCESSIBILITY_OPTIONS} field="accessibility" />

      <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />

      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Operating Hours</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="time" value={startHour} onChange={(e) => handleTimeChange("start", e.target.value)} style={{ padding: 6, border: "1px solid var(--border)" }} />
          <span>to</span>
          <input type="time" value={endHour} onChange={(e) => handleTimeChange("end", e.target.value)} style={{ padding: 6, border: "1px solid var(--border)" }} />
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Unavailable Dates</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} style={{ padding: 6, border: "1px solid var(--border)" }} />
          <button onClick={addDate} style={{ padding: "6px 12px", background: "#f0f0f0", borderRadius: 4, fontSize: 12 }}>Add Date</button>
        </div>
        {formData.unavailableDates.length > 0 && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
            {formData.unavailableDates.map((date) => (
              <span key={date} style={{ fontSize: 11, padding: "3px 8px", background: "#ffeaea", color: "var(--bad-dot)", borderRadius: 4, display: "flex", alignItems: "center", gap: 6 }}>
                {date} 
                <button type="button" onClick={() => removeDate(date)} style={{ border: "none", background: "none", cursor: "pointer", padding: 0, color: "inherit", fontWeight: "bold" }}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 5 }}>
        <button onClick={onCancel} style={{ fontSize: 12, padding: "6px 12px", background: "#f0f0f0", borderRadius: 4 }}>Cancel</button>
        <button onClick={handleSave} style={{ fontSize: 12, padding: "6px 12px", background: "#000", color: "#fff", borderRadius: 4 }}>Save Venue</button>
      </div>
    </div>
  );
}