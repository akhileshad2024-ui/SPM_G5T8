"use client";

import { useRef, useState, type CSSProperties } from "react";
import { apiFetch } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { LAYOUT_OPTIONS, VENUE_ACCESSIBILITY_OPTIONS, VENUE_FACILITY_OPTIONS } from "@/lib/data";
import type { AppliedVenueFilter, Venue, VenueSearchFilters, VenueSearchResponse } from "@/lib/types";
import { EMPTY_FILTERS, buildSearchRequest, clearFilter, filterProblem } from "@/lib/venue-search";
import { venueFromApi } from "@/lib/venue-rules";

const eyebrow: CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-faint)" };

interface Outcome {
  total: number;
  applied: AppliedVenueFilter[];
  message: string | null;
}

/**
 * Event Coordinator: search and filter venues (US20). Each filter in use is shown as a chip that can be
 * cleared by itself. `onResults` gets the matching venues, or null when the search is cleared.
 * Searching only reads; nothing here can change a venue.
 */
export function VenueSearch({ onResults }: { onResults: (venues: Venue[] | null) => void }) {
  const app = useApp();
  const [filters, setFilters] = useState<VenueSearchFilters>(EMPTY_FILTERS);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0); // only the newest search may update the page

  // Only locations that active venues really have, so a search can't be typed wrongly.
  const locations = [...new Set(app.state.venues.filter((v) => v.isActive).map((v) => v.location.trim()))].sort();

  const set = <K extends keyof VenueSearchFilters>(key: K, value: VenueSearchFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const toggle = (key: "accessibility" | "facilities", item: string) =>
    setFilters((f) => ({ ...f, [key]: f[key].includes(item) ? f[key].filter((x) => x !== item) : [...f[key], item] }));

  const run = async (next: VenueSearchFilters) => {
    const invalid = filterProblem(next);
    setProblem(invalid);
    if (invalid) return;

    const id = ++latest.current;
    setBusy(true);
    try {
      const body = buildSearchRequest(next, app.state.events);
      const res = await apiFetch<VenueSearchResponse>("/venues/search", { method: "POST", body: JSON.stringify(body) });
      if (id !== latest.current) return;
      setOutcome({ total: res.total, applied: res.applied_filters, message: res.message });
      onResults(res.venues.map(venueFromApi));
    } catch (err) {
      if (id === latest.current) app.handleApiError(err);
    } finally {
      if (id === latest.current) setBusy(false);
    }
  };

  const clearOne = (key: AppliedVenueFilter["key"]) => {
    const next = clearFilter(filters, key);
    setFilters(next);
    run(next);
  };

  const clearAll = () => {
    latest.current++;
    setFilters(EMPTY_FILTERS);
    setOutcome(null);
    setProblem(null);
    setBusy(false);
    onResults(null);
  };

  const checkboxes = (key: "accessibility" | "facilities", options: readonly string[]) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
      {options.map((opt) => (
        <label key={opt} className="checkbox-row" style={{ fontSize: 12 }}>
          <input type="checkbox" checked={filters[key].includes(opt)} onChange={() => toggle(key, opt)} />
          {opt}
        </label>
      ))}
    </div>
  );

  return (
    <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(filters);
        }}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
        aria-label="Search venues"
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
          <label className="field">
            <span style={eyebrow}>Date</span>
            <input className="text-input" type="date" value={filters.date} onChange={(e) => set("date", e.target.value)} />
          </label>
          <label className="field">
            <span style={eyebrow}>Start time</span>
            <input className="text-input" type="time" value={filters.start} onChange={(e) => set("start", e.target.value)} />
          </label>
          <label className="field">
            <span style={eyebrow}>End time</span>
            <input className="text-input" type="time" value={filters.end} onChange={(e) => set("end", e.target.value)} />
          </label>
          <label className="field">
            <span style={eyebrow}>Expected attendance</span>
            <input className="text-input" type="number" min={1} step={1} value={filters.attendance} onChange={(e) => set("attendance", e.target.value)} />
          </label>
          <label className="field">
            <span style={eyebrow}>Location</span>
            <select className="select-input" value={filters.location} onChange={(e) => set("location", e.target.value)}>
              <option value="">Any location</option>
              {locations.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span style={eyebrow}>Layout</span>
            <select className="select-input" value={filters.layout} onChange={(e) => set("layout", e.target.value as VenueSearchFilters["layout"])}>
              <option value="">Any layout</option>
              {LAYOUT_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {l.charAt(0).toUpperCase() + l.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field">
          <span style={eyebrow}>Accessibility</span>
          {checkboxes("accessibility", VENUE_ACCESSIBILITY_OPTIONS)}
        </div>
        <div className="field">
          <span style={eyebrow}>Facilities</span>
          {checkboxes("facilities", VENUE_FACILITY_OPTIONS)}
        </div>

        {problem && <div className="error-text" role="alert">{problem}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Searching…" : "Search"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={clearAll} disabled={busy}>
            Clear all
          </button>
        </div>
      </form>

      {outcome && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-live="polite">
          {outcome.applied.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span style={eyebrow}>Filters applied</span>
              {outcome.applied.map((f) => (
                <span key={f.key} className="pill-sm" style={{ background: "#EAF1FF", color: "var(--blue)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {f.label}: {f.value}
                  <button
                    type="button"
                    onClick={() => clearOne(f.key)}
                    aria-label={`Clear ${f.label} filter`}
                    style={{ border: "none", background: "transparent", color: "inherit", fontWeight: 700, padding: 0, cursor: "pointer" }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {outcome.message ? (
            <div style={{ fontSize: 13, color: "var(--text-subtle)" }}>{outcome.message}</div>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              {outcome.total} {outcome.total === 1 ? "venue" : "venues"} found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
