"use client";

import { useApp } from "@/lib/app-context";
import { useState, useEffect } from "react";
import { VenueCard } from "@/components/catalogue/VenueCard";
import { VenueForm } from "@/components/catalogue/VenueForm";
import type { Venue } from "@/lib/types";

export default function CataloguePage() {
  const app = useApp();
  const { events } = app.state;
  
  const [venues, setVenues] = useState<Venue[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);

  // Fetch real data from FastAPI
  const fetchVenues = async () => {
    try {
      const response = await fetch("http://127.0.0.1:8000/venues/");
      const data = await response.json();
      setVenues(data);
    } catch (err) {
      console.error("Failed to load venues", err);
    }
  };

  useEffect(() => {
    fetchVenues();
  }, []);

  return (
    <div style={{ padding: "24px 26px 34px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Venue Catalogue</h1>
        <button 
          onClick={() => setShowAddForm(true)}
          style={{ padding: "8px 16px", background: "black", color: "white", borderRadius: 4 }}
        >
          + Add Venue
        </button>
      </div>

      {showAddForm && (
        <VenueForm 
          onSuccess={() => { setShowAddForm(false); fetchVenues(); }} 
          onCancel={() => setShowAddForm(false)} 
        />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(288px, 1fr))", gap: 14 }}>
        {venues.map((v) => (
          <VenueCard
            key={v.id}
            venue={v}
            booked={events.filter((e) => e.venue === v.id && e.bookingState === "approved").length}
            onRefresh={fetchVenues}
          />
        ))}
      </div>
    </div>
  );
}