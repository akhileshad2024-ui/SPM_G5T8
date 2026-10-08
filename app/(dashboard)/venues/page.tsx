"use client";

import { useState } from "react";
import { VenueDetails } from "@/components/venues/VenueDetails";
import { ApiError, apiFetch } from "@/lib/api/client";
import { useApp } from "@/lib/state/app-context";
import type { ApiVenue, Venue } from "@/lib/types";
import { venueFromApi } from "@/lib/venues/rules";

/** Event Coordinator: read-only look at every active venue (US18). Nothing here can edit a venue. */
export default function VenuesPage() {
  const app = useApp();
  const venues = app.state.venues.filter((v) => v.isActive); // deactivated venues are left out
  const [selected, setSelected] = useState<Venue | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const open = async (id: string) => {
    setLoadingId(id);
    try {
      setSelected(venueFromApi(await apiFetch<ApiVenue>(`/venues/${id}`)));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Deactivated or removed since the list was loaded.
        app.flash("That venue is no longer available.", "warn");
        setSelected(null);
        await app.reloadVenues();
      } else {
        app.handleApiError(err);
      }
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div style={{ padding: "24px 26px 34px", display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        {venues.map((v) => (
          <div
            key={v.id}
            className="card"
            style={{
              padding: "14px 18px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              border: selected?.id === v.id ? "1px solid var(--blue)" : undefined,
            }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{v.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 3 }}>
                {v.building} · capacity {v.cap}
              </div>
            </div>
            <button className="btn btn-ghost" onClick={() => open(v.id)} disabled={loadingId === v.id}>
              {loadingId === v.id ? "Loading…" : "View details"}
            </button>
          </div>
        ))}
        {venues.length === 0 && (
          <div className="card" style={{ padding: 46, textAlign: "center", fontSize: 13, color: "var(--text-subtle)" }}>
            No active venues in the catalogue.
          </div>
        )}
      </div>

      <div style={{ flex: "1 1 340px", minWidth: 0 }}>
        {selected ? (
          <VenueDetails venue={selected} />
        ) : (
          <div className="card" style={{ padding: 46, textAlign: "center", fontSize: 13, color: "var(--text-subtle)" }}>
            Choose a venue to see its details.
          </div>
        )}
      </div>
    </div>
  );
}
