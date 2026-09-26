"use client";

import { useApp } from "@/lib/app-context";
import { ACCESS_OPTIONS, EQUIP, FACILITY_OPTIONS } from "@/lib/data";
import type { Layout } from "@/lib/types";
import styles from "./StepRequirements.module.css";

const LAYOUTS: Layout[] = ["banquet", "theatre", "standing", "boardroom", "classroom"];

export function StepRequirements() {
  const app = useApp();
  const { form } = app.state;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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
        {EQUIP.map((x) => (
          <div key={x.id} className={styles.equipRow}>
            <span className={styles.equipName}>{x.name}</span>
            <span className={styles.equipPool}>
              {app.freeQty(x.id, null)} of {x.total} free
            </span>
            <div className={styles.stepper}>
              <button className={styles.stepperButton} onClick={() => app.bumpEquip(x.id, -1)}>
                −
              </button>
              <span className={styles.stepperValue}>{form.equip[x.id] || 0}</span>
              <button className={styles.stepperButton} onClick={() => app.bumpEquip(x.id, 1)}>
                +
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
