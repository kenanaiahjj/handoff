-- Which canvas features each workspace role gets (element inspection, copy as image, …), as JSON
-- set by owners in Settings. NULL means the defaults in src/lib/role-features.ts.
ALTER TABLE workspace ADD COLUMN role_features text;
