"use client";

import { useState } from "react";
import { useApp } from "@/lib/state/app-context";
import { VenueCard } from "@/components/catalogue/VenueCard";
import { VenueForm } from "@/components/catalogue/VenueForm";

export default function CataloguePage() {
  const app = useApp();
  const [showAddForm, setShowAddForm] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const venues = app.state.venues.filter((v) => showInactive || v.isActive);
  const inactiveCount = app.state.venues.length - app.state.venues.filter((v) => v.isActive).length;

  return (
    <div style={{ padding: "24px 26px 34px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Venue Catalogue</h1>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <label className="checkbox-row" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={showInactive} onChange={() => setShowInactive((s) => !s)} />
            Show deactivated ({inactiveCount})
          </label>
          <button onClick={() => setShowAddForm(true)} style={{ padding: "8px 16px", background: "black", color: "white", borderRadius: 4 }}>
            + Add Venue
          </button>
        </div>
      </div>

      {showAddForm && (
        <div style={{ marginBottom: 14 }}>
          <VenueForm
            onSuccess={(result) => {
              setShowAddForm(false);
              app.flash(`${result.venue.name} added to the catalogue.`);
            }}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(288px, 1fr))", gap: 14 }}>
        {venues.map((v) => (
          <VenueCard key={v.id} venue={v} />
        ))}
      </div>
      {venues.length === 0 && (
        <div className="card" style={{ padding: 46, textAlign: "center", fontSize: 13, color: "var(--text-subtle)" }}>
          No venues yet. Add one to get started.
        </div>
      )}
    </div>
  );
}
