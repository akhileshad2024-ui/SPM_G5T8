"use client";

import { useApp } from "@/lib/state/app-context";
import { ACCESS_OPTIONS, EQUIP, FACILITY_OPTIONS } from "@/lib/data/options";
import type { Layout } from "@/lib/types";
import styles from "./StepRequirements.module.css";

const LAYOUTS: Layout[] = ["banquet", "theatre", "standing", "boardroom", "classroom"];

export function StepRequirements() {
  const app = useApp();
  const { form, formErrors } = app.state;
  const selectedEquipment = EQUIP.filter((item) => (form.equip[item.id] ?? 0) > 0);

  const error = (field: string) =>
    formErrors[field] ? <div className="error-text">{formErrors[field]}</div> : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 16 }}>
        <div className="field">
          <label className="eyebrow">Preferred venue location</label>
          <input
            className="text-input"
            value={form.venueLocation}
            onChange={(e) => app.setFormField("venueLocation", e.target.value)}
            placeholder="Main campus"
          />
          {error("venue.location")}
        </div>
        <div className="field">
          <label className="eyebrow">Required capacity</label>
          <input
            className="text-input tabular"
            type="number"
            min="1"
            step="1"
            value={form.venueCapacity}
            onChange={(e) => app.setFormField("venueCapacity", e.target.value)}
            placeholder="180"
          />
          {error("venue.capacity")}
        </div>
      </div>

      <div className="field">
        <label className="eyebrow">Required layout</label>
        <div className={styles.chipRow}>
          {LAYOUTS.map((l) => (
            <button
              key={l}
              className={`${styles.chip} ${form.layout === l ? styles.chipOn : ""}`}
              onClick={() => app.setFormField("layout", l)}
            >
              {l.charAt(0).toUpperCase() + l.slice(1)}
            </button>
          ))}
        </div>
        {error("venue.layout")}
      </div>

      <div className="field">
        <label className="eyebrow">Facilities needed</label>
        <div className={styles.chipRow}>
          {FACILITY_OPTIONS.map((x) => (
            <button
              key={x}
              className={`${styles.chip} ${form.facilities.indexOf(x) > -1 ? styles.chipOn : ""}`}
              onClick={() => app.toggleFormList("facilities", x)}
            >
              {x}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="eyebrow">Accessibility needs</label>
        <div className={styles.chipRow}>
          {ACCESS_OPTIONS.map((x) => (
            <button
              key={x}
              className={`${styles.chip} ${form.access.indexOf(x) > -1 ? styles.chipOn : ""}`}
              onClick={() => app.toggleFormList("access", x)}
            >
              {x}
            </button>
          ))}
        </div>
      </div>

      <div style={{ height: 1, background: "var(--border)" }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label className="eyebrow">Equipment requirements</label>
        {EQUIP.map((x) => {
          const selectedIndex = selectedEquipment.findIndex((item) => item.id === x.id);
          return (
            <div key={x.id} className={styles.equipmentItem}>
              <div className={styles.equipRow}>
                <span className={styles.equipName}>{x.name}</span>
                <span className={styles.equipPool}>
                  {app.freeQty(x.id, null)} of {x.total} free
                </span>
                <div className={styles.stepper}>
                  <button type="button" className={styles.stepperButton} onClick={() => app.bumpEquip(x.id, -1)}>
                    −
                  </button>
                  <span className={styles.stepperValue}>{form.equip[x.id] || 0}</span>
                  <button type="button" className={styles.stepperButton} onClick={() => app.bumpEquip(x.id, 1)}>
                    +
                  </button>
                </div>
              </div>
              {selectedIndex >= 0 && (
                <div className="field" style={{ padding: "10px 14px 13px" }}>
                  <label className="eyebrow">Technical requirements for {x.name}</label>
                  <input
                    className="text-input"
                    value={form.equipTechnical[x.id] ?? ""}
                    onChange={(e) =>
                      app.setFormField("equipTechnical", {
                        ...form.equipTechnical,
                        [x.id]: e.target.value,
                      })
                    }
                    placeholder="Connections, setup, compatibility or power needs"
                  />
                  {error(`equipment.${selectedIndex}.technicalRequirements`)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
