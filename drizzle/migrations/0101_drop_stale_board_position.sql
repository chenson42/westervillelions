-- Drop the legacy members.board_position column. Superseded by
-- group_memberships.position (joined through the "Board of Directors"
-- group) via src/lib/board-positions.ts — see DECISION-097. The column had
-- drifted out of sync with the actual board (verified 2026-09-18: 6 of 13
-- current officers wrong, the rest null) and nothing should read it again.
ALTER TABLE members DROP COLUMN IF EXISTS board_position;
