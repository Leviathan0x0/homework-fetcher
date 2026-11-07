-- Performance: one index for the case-insensitive sign-in fallback.
--
-- `users.find_by_school_id_ignore_case` filters on `lower(trim(school_id))`, an
-- expression the UNIQUE index on `school_id` cannot serve, so every sign-in that missed
-- the exact match scanned the whole users table -- and an unknown ID is exactly what a
-- credential-guessing client sends. An expression index with the identical expression
-- turns that into a lookup. Not UNIQUE: the query deliberately detects ambiguous matches
-- itself rather than refusing to store them.
CREATE INDEX idx_users_school_id_normalized ON users (lower(trim(school_id)));
