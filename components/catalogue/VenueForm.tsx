import { useState, type CSSProperties, type ReactNode } from "react";
import { useApp, type SaveVenueResult } from "@/lib/state/app-context";
import { LAYOUT_OPTIONS, VENUE_ACCESSIBILITY_OPTIONS, VENUE_FACILITY_OPTIONS } from "@/lib/data/options";
import type { UnavailabilityPeriod, UnavailabilityReason, Venue } from "@/lib/types";
import { MAX_BUFFER_MINUTES, validateVenueForm, venueFormFrom, venueInputFrom, type VenueFormState } from "@/lib/venues/form";
import { UNAVAILABILITY_REASONS, WEEKDAYS } from "@/lib/venues/rules";

const inputStyle: CSSProperties = { padding: 8, border: "1px solid var(--border)", width: "100%", boxSizing: "border-box" };
const smallInput: CSSProperties = { padding: 6, border: "1px solid var(--border)" };
const headingStyle: CSSProperties = { fontSize: 12, fontWeight: 600, marginBottom: 6 };

type ListField = "layouts" | "facilities" | "accessibility" | "operatingDays";

function FieldError({ errors, field }: { errors: Record<string, string>; field: string }) {
  // Backend keys can be nested ("unavailability.0.end"); show anything under this field.
  const messages = Object.entries(errors)
    .filter(([key]) => key === field || key.startsWith(`${field}.`))
    .map(([, msg]) => msg);
  if (!messages.length) return null;
  return <div style={{ fontSize: 11.5, color: "var(--bad-dot)", marginTop: 4 }}>{messages.join(" ")}</div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div style={headingStyle}>{title}</div>
      {children}
    </div>
  );
}

export function VenueForm({
  initialData,
  onSuccess,
  onCancel,
}: {
  initialData?: Venue | null;
  onSuccess: (result: Extract<SaveVenueResult, { ok: true }>) => void;
  onCancel: () => void;
}) {
  const app = useApp();
  const [form, setForm] = useState<VenueFormState>(() => venueFormFrom(initialData));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof VenueFormState>(key: K, value: VenueFormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const toggle = (field: ListField, item: string) =>
    setForm((f) => ({
      ...f,
      [field]: f[field].includes(item) ? f[field].filter((i) => i !== item) : [...f[field], item],
    }));

  const setPeriod = (index: number, changes: Partial<UnavailabilityPeriod>) =>
    set("unavailability", form.unavailability.map((p, i) => (i === index ? { ...p, ...changes } : p)));

  const addPeriod = () =>
    set("unavailability", [...form.unavailability, { start: "", end: "", reason: "maintenance", note: "" }]);

  const removePeriod = (index: number) => set("unavailability", form.unavailability.filter((_, i) => i !== index));

  // The fixed set, plus any older value already saved on this venue, so it can still be seen and unticked.
  const accessibilityOptions = [
    ...VENUE_ACCESSIBILITY_OPTIONS,
    ...form.accessibility.filter((a) => !VENUE_ACCESSIBILITY_OPTIONS.some((o) => o.toLowerCase() === a.toLowerCase())),
  ];

  const handleSave = async () => {
    const clientErrors = validateVenueForm(form);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) {
      app.flash("Fix the highlighted fields before saving.", "warn");
      return;
    }
    setSaving(true);
    const result = await app.saveVenue(initialData?.id ?? null, venueInputFrom(form));
    setSaving(false);
    if (result.ok) {
      onSuccess(result);
    } else {
      setErrors(Object.keys(result.fields).length ? result.fields : { _: result.error });
    }
  };

  const CheckboxGroup = ({ title, options, field, label = (o: string) => o }: { title: string; options: readonly string[]; field: ListField; label?: (o: string) => string }) => (
    <Section title={title}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {options.map((opt) => (
          <label key={opt} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={form[field].includes(opt)} onChange={() => toggle(field, opt)} />
            {label(opt)}
          </label>
        ))}
      </div>
      <FieldError errors={errors} field={field} />
    </Section>
  );

  return (
    <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{initialData ? "Edit Venue" : "Add Venue"}</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <input aria-label="Venue name" placeholder="Venue Name" value={form.name} onChange={(e) => set("name", e.target.value)} style={inputStyle} />
          <FieldError errors={errors} field="name" />
        </div>
        <div>
          <input aria-label="Location" placeholder="Location" value={form.location} onChange={(e) => set("location", e.target.value)} style={inputStyle} />
          <FieldError errors={errors} field="location" />
        </div>
        <div>
          <input aria-label="Capacity" placeholder="Capacity" type="number" min={1} step={1} value={form.cap} onChange={(e) => set("cap", e.target.value)} style={inputStyle} />
          <FieldError errors={errors} field="cap" />
        </div>
      </div>

      <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />

      <CheckboxGroup title="Supported Layouts" options={LAYOUT_OPTIONS} field="layouts" label={(l) => l.charAt(0).toUpperCase() + l.slice(1)} />
      <CheckboxGroup title="Facilities" options={VENUE_FACILITY_OPTIONS} field="facilities" />
      <CheckboxGroup title="Accessibility Features" options={accessibilityOptions} field="accessibility" />

      <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />

      <Section title="Operating Hours">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input aria-label="Opening time" type="time" value={form.openTime} onChange={(e) => set("openTime", e.target.value)} style={smallInput} />
          <span>to</span>
          <input aria-label="Closing time" type="time" value={form.closeTime} onChange={(e) => set("closeTime", e.target.value)} style={smallInput} />
        </div>
        <FieldError errors={errors} field="operatingHours" />
      </Section>

      <CheckboxGroup title="Operating Days" options={WEEKDAYS} field="operatingDays" />

      <Section title="Setup & Turnaround">
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 6 }}>
          Time the room is needed before each event to prepare it and after each event to reset it. Bookings can&apos;t overlap these periods.
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            Setup
            <input aria-label="Setup minutes" type="number" min={0} max={MAX_BUFFER_MINUTES} step={5} value={form.setupMinutes} onChange={(e) => set("setupMinutes", e.target.value)} style={{ ...smallInput, width: 80 }} />
            min
          </label>
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            Turnaround
            <input aria-label="Turnaround minutes" type="number" min={0} max={MAX_BUFFER_MINUTES} step={5} value={form.turnaroundMinutes} onChange={(e) => set("turnaroundMinutes", e.target.value)} style={{ ...smallInput, width: 80 }} />
            min
          </label>
        </div>
        <FieldError errors={errors} field="setupMinutes" />
        <FieldError errors={errors} field="turnaroundMinutes" />
      </Section>

      <Section title="Temporarily Unavailable">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {form.unavailability.map((p, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, background: "#fafafb", borderRadius: 4 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input aria-label="Unavailable from" type="datetime-local" value={p.start} onChange={(e) => setPeriod(i, { start: e.target.value })} style={smallInput} />
                <span style={{ fontSize: 12 }}>to</span>
                <input aria-label="Unavailable until" type="datetime-local" value={p.end} onChange={(e) => setPeriod(i, { end: e.target.value })} style={smallInput} />
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <select aria-label="Reason" value={p.reason} onChange={(e) => setPeriod(i, { reason: e.target.value as UnavailabilityReason })} style={smallInput}>
                  {Object.entries(UNAVAILABILITY_REASONS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <input aria-label="Note" placeholder={p.reason === "other" ? "Note (required)" : "Note (optional)"} value={p.note ?? ""} onChange={(e) => setPeriod(i, { note: e.target.value })} style={{ ...smallInput, flex: 1, minWidth: 120 }} />
                <button type="button" onClick={() => removePeriod(i)} style={{ fontSize: 12, padding: "4px 8px", background: "#f0f0f0", borderRadius: 4 }}>
                  Remove
                </button>
              </div>
              <FieldError errors={errors} field={`unavailability.${i}`} />
            </div>
          ))}
          <button type="button" onClick={addPeriod} style={{ alignSelf: "flex-start", padding: "6px 12px", background: "#f0f0f0", borderRadius: 4, fontSize: 12 }}>
            + Add unavailable period
          </button>
          <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
            Existing bookings in these periods are kept and flagged to their coordinators.
          </div>
        </div>
      </Section>

      <FieldError errors={errors} field="_" />

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 5 }}>
        <button onClick={onCancel} style={{ fontSize: 12, padding: "6px 12px", background: "#f0f0f0", borderRadius: 4 }}>Cancel</button>
        <button onClick={handleSave} disabled={saving} style={{ fontSize: 12, padding: "6px 12px", background: "#000", color: "#fff", borderRadius: 4 }}>
          {saving ? "Saving…" : "Save Venue"}
        </button>
      </div>
    </div>
  );
}
