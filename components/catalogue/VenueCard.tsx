import { useState } from "react";
import { Dot } from "@/components/ui/Dot";
import { Tag } from "@/components/ui/Pill";
import type { Venue } from "@/lib/types";
import { VenueForm } from "./VenueForm";

export function VenueCard({ venue, booked, onRefresh }: { venue: Venue; booked: number; onRefresh: () => void }) {
  const [isEditing, setIsEditing] = useState(false);

  const handleDeactivate = async () => {
    if (booked > 0) {
      alert("Cannot deactivate a venue with existing confirmed bookings.");
      return;
    }
    
    try {
      await fetch(`http://127.0.0.1:8000/venues/${venue.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false, user_id: "staff_123" }),
      });
      onRefresh();
    } catch (err) {
      console.error("Failed to deactivate venue", err);
    }
  };

  if (isEditing) {
    return (
      <VenueForm 
        initialData={venue} 
        onSuccess={() => { setIsEditing(false); onRefresh(); }} 
        onCancel={() => setIsEditing(false)} 
      />
    );
  }

  return (
    <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{venue.name}</div>
        <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>{venue.building}</div>
      </div>

      <div style={{ display: "flex", gap: 20 }}>
        <div>
          <div className="display-number" style={{ fontSize: 30 }}>
            {venue.cap}
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-faint)", marginTop: 5 }}>
            Capacity
          </div>
        </div>
        <div>
          <div className="display-number" style={{ fontSize: 30 }}>
            {booked}
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-faint)", marginTop: 5 }}>
            Bookings
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: "var(--border)" }} />

      {venue.operatingHours && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          <strong>Hours:</strong> {venue.operatingHours}
        </div>
      )}

      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 7 }}>
          Layouts
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {venue.layouts?.map((l) => (
            <span
              key={l}
              style={{
                fontSize: 11.5,
                padding: "3px 9px",
                border: "1px solid var(--border-strong)",
                borderRadius: 999,
                textTransform: "capitalize",
              }}
            >
              {l}
            </span>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 7 }}>
          Facilities
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {venue.facilities?.map((f) => (
            <Tag key={f} label={f} />
          ))}
        </div>
      </div>

      {venue.characteristics && venue.characteristics.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 7 }}>
            Characteristics
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {venue.characteristics.map((c) => (
              <Tag key={c} label={c} />
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 7 }}>
        <Dot color={venue.stepFree ? "var(--ok-dot)" : "var(--bad-dot)"} />
        {venue.stepFree ? "Step-free access throughout" : "Stair access only — not step-free"}
      </div>

      <div style={{ height: 1, background: "var(--border)", marginTop: 10 }} />
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 5 }}>
        <button onClick={() => setIsEditing(true)} style={{ fontSize: 12, padding: "4px 8px", background: "#f0f0f0", borderRadius: 4 }}>
          Edit
        </button>
        <button onClick={handleDeactivate} style={{ fontSize: 12, padding: "4px 8px", color: "var(--bad-dot)", background: "#ffeaea", borderRadius: 4 }}>
          Deactivate
        </button>
      </div>
    </div>
  );
}