"use client";

import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api/client";
import { useApp } from "@/lib/state/app-context";
import {
  WEEKDAY_HEADERS,
  campusToday,
  clashingPeriods,
  dayHeading,
  moveAnchor,
  periodName,
  periodNotes,
  periodTimes,
  periodsOn,
  rangeLabel,
  visibleDays,
  type CalendarPeriod,
  type CalendarVenue,
  type CalendarView,
} from "@/lib/venues/calendar";
import styles from "./AvailabilityCalendar.module.css";

/** How often the shown range is fetched again, the same pace as the page's notifications. */
const REFRESH_MS = 15_000;

const VIEWS:Array<[CalendarView, string]> = [
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
];

const KIND_LABEL: Record<CalendarPeriod["kind"], string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  expired: "Released",
  unavailable: "Unavailable",
};

const LEGEND: Array<[string, string]> = [
  [styles.confirmed, "Confirmed"],
  [styles.pending, "Pending"],
  [styles.clash, "Conflict (incl. setup & turnaround)"],
  [styles.unavailable, "Unavailable"],
  [styles.expired, "Released (hold expired)"],
];

/** One booking, hold or unavailable period. `venueName` is shown where the cell doesn't say which venue it is. */
function Period({ period, clash, venueName }: { period: CalendarPeriod; clash: boolean; venueName?: string }) {
  return (
    <div className={`${styles.period} ${clash ? styles.clash : styles[period.kind]}`} aria-label={`${KIND_LABEL[period.kind]}: ${periodName(period)}`}>
      {venueName && <div className={styles.periodVenue}>{venueName}</div>}
      <div className={styles.periodName}>{periodName(period)}</div>
      <div className={styles.periodTimes}>{periodTimes(period)}</div>
      {periodNotes(period).map((note) => (
        <div key={note} className={styles.periodNote}>{note}</div>
      ))}
    </div>
  );
}

function DayPeriods({ venue, day, showVenue }: { venue: CalendarVenue; day: string; showVenue: boolean }) {
  const clashes = clashingPeriods(venue.periods);
  return periodsOn(venue.periods, day).map((period, i) => (
    <Period key={`${period.kind}-${period.start}-${i}`} period={period} clash={clashes.has(period)} venueName={showVenue ? venue.name : undefined} />
  ));
}

/** Day and week: a row per venue, a column per day. */
export function VenueRows({ venues, days }: { venues: CalendarVenue[]; days: string[] }) {
  const columns = { gridTemplateColumns: `150px repeat(${days.length}, minmax(0, 1fr))` };
  return (
    <div className={days.length > 1 ? styles.wideGrid : styles.grid}>
      <div className={styles.headerRow} style={columns}>
        <div />
        {days.map((day) => <div key={day}>{dayHeading(day)}</div>)}
      </div>
      {venues.map((venue) => (
        <div key={venue.id} className={styles.row} style={columns}>
          <div className={styles.venueCell}>
            <div className={styles.venueName}>{venue.name}</div>
            <div className={styles.venueMeta}>+{venue.setup_minutes}/{venue.turnaround_minutes} min</div>
          </div>
          {days.map((day) => (
            <div key={day} className={styles.cell} role="group" aria-label={`${venue.name} on ${day}`}>
              <DayPeriods venue={venue} day={day} showVenue={false} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Month: a square per day, Monday first. With several venues shown, each entry says which venue it is. */
export function MonthGrid({ venues, days, month }: { venues: CalendarVenue[]; days: string[]; month: string }) {
  return (
    <div className={styles.wideGrid}>
      <div className={styles.monthRow}>
        {WEEKDAY_HEADERS.map((name) => <div key={name} className={styles.monthHeading}>{name}</div>)}
        {days.map((day) => (
          <div key={day} className={`${styles.cell} ${day.startsWith(month) ? "" : styles.otherMonth}`} role="group" aria-label={day}>
            <div className={styles.dayNumber}>{Number(day.slice(8))}</div>
            {venues.map((venue) => <DayPeriods key={venue.id} venue={venue} day={day} showVenue={venues.length > 1} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** US19: each venue's bookings, holds and unavailable periods, by day, week or month. */
export function AvailabilityCalendar() {
  const app = useApp();
  const { events, venues: catalogue } = app.state;
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(() => campusToday());
  const [venueId, setVenueId] = useState("all");
  // Every reply is kept with the range it was asked for, so days that haven't loaded are never drawn from another range's data.
  const [loaded, setLoaded] = useState<{ range: string; venues: CalendarVenue[] } | null>(null);
  const [failed, setFailed] = useState<{ range: string; message: string } | null>(null);
  const [tick, setTick] = useState(0);

  const days = visibleDays(view, anchor);
  const first = days[0];
  const last = days[days.length - 1];
  const range = `${first}..${last}`;

  // A hold that runs out is released by the server without the page being told, so ask again now and then.
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  // Asked for again when the page's events or venues change, so a decision made here shows straight away.
  useEffect(() => {
    let current = true;
    apiFetch<CalendarVenue[]>(`/venues/availability?start=${first}&end=${last}`)
      .then((found) => {
        if (!current) return;
        setLoaded({ range, venues: found });
        setFailed(null);
      })
      .catch((err) => {
        if (current) setFailed({ range, message: err instanceof ApiError ? err.message : "The calendar could not be loaded. Try again." });
      });
    return () => {
      current = false;
    };
  }, [first, last, range, events, catalogue, tick]);

  const venues = loaded?.range === range ? loaded.venues : null;
  const error = failed?.range === range ? failed.message : "";
  const shown = (venues ?? []).filter((v) => venueId === "all" || String(v.id) === venueId);

  return (
    <div className={`card ${styles.card}`}>
      <div className={styles.head}>
        <div className={styles.headTitle}>Venue availability · {rangeLabel(view, anchor)}</div>
        <div className={styles.legend}>
          {LEGEND.map(([swatch, label]) => (
            <span key={label} className={styles.legendItem}>
              <span className={`${styles.legendSwatch} ${swatch}`} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.toolGroup} role="group" aria-label="Calendar view">
          {VIEWS.map(([value, label]) => (
            <button
              key={value}
              className={`btn btn-sm ${view === value ? "btn-primary" : "btn-ghost"}`}
              aria-pressed={view === value}
              onClick={() => setView(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.toolGroup}>
          <button className="btn btn-sm btn-ghost" aria-label={`Previous ${view}`} onClick={() => setAnchor(moveAnchor(view, anchor, -1))}>‹</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setAnchor(campusToday())}>Today</button>
          <button className="btn btn-sm btn-ghost" aria-label={`Next ${view}`} onClick={() => setAnchor(moveAnchor(view, anchor, 1))}>›</button>
          <input
            type="date"
            className={`text-input ${styles.toolInput}`}
            aria-label="Go to date"
            value={anchor}
            onChange={(e) => e.target.value && setAnchor(e.target.value)}
          />
        </div>
        <select className={`select-input ${styles.toolInput}`} aria-label="Venue" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
          <option value="all">All venues</option>
          {(loaded?.venues ?? []).map((v) => <option key={v.id} value={String(v.id)}>{v.name}</option>)}
        </select>
      </div>

      <div className={styles.body}>
        {error && <div className="error-text" role="alert">{error}</div>}
        {!error && venues === null && <div className={styles.message}>Loading the calendar…</div>}
        {venues !== null && venues.length === 0 && <div className={styles.message}>No active venues in the catalogue.</div>}
        {shown.length > 0 && (view === "month"
          ? <MonthGrid venues={shown} days={days} month={anchor.slice(0, 7)} />
          : <VenueRows venues={shown} days={days} />)}
      </div>
    </div>
  );
}
