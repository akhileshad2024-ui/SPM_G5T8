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

-- 2d. US43: the Event Coordinator Lead role. The users.role check constraint must allow 'lead'.
--     (The event_assignments table for US11 is created by the backend on start-up.)
ALTER TABLE users DROP CONSTRAINT IF EXISTS user_role;
ALTER TABLE users ADD CONSTRAINT user_role
  CHECK (role IN ('organiser', 'coordinator', 'venue', 'tech', 'attendee', 'lead'));

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

-- US38 (Week 7 change #1): a booking whose venue setup/turnaround change makes it overlap another is
-- marked "Requires Reassessment". reassessment holds the reason, the bookings it clashes with and when it was
-- flagged (NULL when nothing needs reassessing). Safe to run more than once.
ALTER TABLE venue_bookings ADD COLUMN IF NOT EXISTS reassessment json;

-- US44 (Week 7 change CR-W7-6): the Operational Safety Check. Safe to run more than once.
-- (The safety_reviews table is created by the backend on start-up.)
-- The Safety Officer role: the users.role check constraint must allow 'safety'.
ALTER TABLE users DROP CONSTRAINT IF EXISTS user_role;
ALTER TABLE users ADD CONSTRAINT user_role
  CHECK (role IN ('organiser', 'coordinator', 'venue', 'tech', 'attendee', 'lead', 'safety'));
-- The four safety statuses: the event status check constraints must allow them.
ALTER TABLE events DROP CONSTRAINT IF EXISTS event_status;
ALTER TABLE events ADD CONSTRAINT event_status CHECK (status IN (
    'draft', 'submitted', 'under_review', 'pending_clarification', 'approved', 'confirmed', 'rejected', 'cancelled',
    'pending_safety_review', 'safety_changes_requested', 'safety_approved', 'safety_rejected'));
ALTER TABLE event_status_changes DROP CONSTRAINT IF EXISTS event_status_from;
ALTER TABLE event_status_changes ADD CONSTRAINT event_status_from CHECK (from_status IN (
    'draft', 'submitted', 'under_review', 'pending_clarification', 'approved', 'confirmed', 'rejected', 'cancelled',
    'pending_safety_review', 'safety_changes_requested', 'safety_approved', 'safety_rejected'));
ALTER TABLE event_status_changes DROP CONSTRAINT IF EXISTS event_status_to;
ALTER TABLE event_status_changes ADD CONSTRAINT event_status_to CHECK (to_status IN (
    'draft', 'submitted', 'under_review', 'pending_clarification', 'approved', 'confirmed', 'rejected', 'cancelled',
    'pending_safety_review', 'safety_changes_requested', 'safety_approved', 'safety_rejected'));
-- A Safety Officer account is created like the others, in the users table; then give it a password with
--   python -m login.set_password <email>      (run from backend/)
-- Example (the password_hash is replaced by set_password):
-- INSERT INTO users (email, name, role, password_hash, is_active, failed_login_attempts, session_version)
-- VALUES ('hannah.lau@connectsphere.edu', 'Hannah Lau', 'safety', 'set-with-set_password', true, 0, 0);
