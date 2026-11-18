-- Browser push subscriptions (the installed app or a browser tab), one row per device.
CREATE TABLE push_subscription (
  endpoint text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at text NOT NULL,
  last_success_at text
);
CREATE INDEX push_subscription_user ON push_subscription (user_id);
ALTER TABLE push_subscription ENABLE ROW LEVEL SECURITY;
