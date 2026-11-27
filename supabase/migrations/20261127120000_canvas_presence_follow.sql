-- Follow mode: each viewer's visible area of the canvas (Figma page units) and whom they're following,
-- so someone can follow another person's view and the followed person can see that they are.
ALTER TABLE canvas_presence
  ADD COLUMN view_x double precision,
  ADD COLUMN view_y double precision,
  ADD COLUMN view_width double precision,
  ADD COLUMN view_height double precision,
  ADD COLUMN following_user_id text;
