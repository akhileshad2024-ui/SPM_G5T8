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

-- 3. LATER, once every teammate's branch uses the new venue model (staging/main merged and pulled).
--    Branches that still read "unavailableDates" break without it. This cannot be undone.
-- ALTER TABLE venues DROP COLUMN "unavailableDates";
