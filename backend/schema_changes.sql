-- Database changes for US17 (venue catalogue) that the backend does not apply by itself.
-- Run these once, in order, in the Supabase dashboard -> SQL Editor.
-- (SQLAlchemy's create_all only creates missing tables; it never changes existing ones.)

-- 1. Week 7 change #1 (setup/turnaround time) and #2 (unavailability periods with a reason).
--    Safe to run more than once.
ALTER TABLE venues ADD COLUMN IF NOT EXISTS setup_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS turnaround_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS unavailability json;

-- 2. Copy the old whole-day "unavailableDates" into unavailability periods.
--    Check first:  SELECT id, name, "unavailableDates" FROM venues;
--    Skip this step if every row is empty. Only fills venues that have no periods yet.
UPDATE venues v
SET unavailability = s.periods
FROM (
  SELECT v2.id,
         json_agg(json_build_object(
           'start', left(d, 10) || 'T00:00:00',
           'end', to_char(left(d, 10)::date + 1, 'YYYY-MM-DD') || 'T00:00:00',
           'reason', 'other',
           'note', 'Unavailable all day (migrated from the old unavailable-dates list)'
         ) ORDER BY d) AS periods
  FROM venues v2, json_array_elements_text(v2."unavailableDates") AS d
  WHERE d ~ '^\d{4}-\d{2}-\d{2}'
  GROUP BY v2.id
) s
WHERE v.id = s.id AND v.unavailability IS NULL;

-- 2b. US39: bookings caught by an unavailability period are flagged, never cancelled. Safe to run more than once.
ALTER TABLE venue_bookings ADD COLUMN IF NOT EXISTS flag json;

-- 2c. US41: each booking of an event has its own purpose (e.g. "Breakout session"). Safe to run more than once.
ALTER TABLE venue_bookings ADD COLUMN IF NOT EXISTS purpose varchar;

-- 2d. US38: a booking whose venue setup/turnaround change makes it overlap another is marked "Requires Reassessment".
--     US48: a pending hold can have an expiry time; once it has passed it no longer blocks the venue.
--     Safe to run more than once.
ALTER TABLE venue_bookings ADD COLUMN IF NOT EXISTS reassessment json;
ALTER TABLE venue_bookings ADD COLUMN IF NOT EXISTS hold_expires_at timestamp with time zone;

-- 3. LATER, once every teammate's branch uses the new venue model (staging/main merged and pulled).
--    Branches that still read "unavailableDates" break without it. This cannot be undone.
-- ALTER TABLE venues DROP COLUMN "unavailableDates";

-- US42 (Week 7 change CR-W7-4): tentative venue holds expire. Safe to run more than once.
-- hold_expires_at is when an unapproved (pending) request stops holding its venue; hold_expiry_set_by
-- is the Venue Staff member who last set it (NULL while it is the default given on request).
ALTER TABLE venue_bookings ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz;
ALTER TABLE venue_bookings ADD COLUMN IF NOT EXISTS hold_expiry_set_by text;
-- Give requests already pending the default expiry: 3 days after they were requested, but no later than
-- the start of setup (hold_start is Singapore wall-clock time). Rows that already have one are left alone.
UPDATE venue_bookings
SET hold_expires_at = LEAST(requested_at + interval '3 days', hold_start AT TIME ZONE 'Asia/Singapore')
WHERE status = 'pending' AND hold_expires_at IS NULL;
