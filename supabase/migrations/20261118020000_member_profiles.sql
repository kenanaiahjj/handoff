-- Profiles: what people show their team (title, department, …) and an uploaded photo.
-- The photo's URL is also written to "user".image so every session already carries it. Until
-- someone uploads one, "user".image is their sign-in provider's picture (Google), kept in
-- previous_image while an upload replaces it so removing the upload brings it back.
CREATE TABLE user_about (
  user_id text PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  title text CHECK (title IS NULL OR length(title) <= 80),
  department text CHECK (department IS NULL OR length(department) <= 60),
  pronouns text CHECK (pronouns IS NULL OR length(pronouns) <= 30),
  timezone text CHECK (timezone IS NULL OR length(timezone) <= 64),
  bio text CHECK (bio IS NULL OR length(bio) <= 280),
  updated_at text NOT NULL
);

CREATE TABLE user_avatar (
  user_id text PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes bytea NOT NULL,
  sha256 text NOT NULL,
  previous_image text,
  updated_at text NOT NULL
);
