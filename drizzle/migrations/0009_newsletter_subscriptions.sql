-- Newsletter subscriptions table
CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'website',
  subscribed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  unsubscribed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Unique index on email (case-insensitive)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'newsletter_subscriptions_email_unique'
  ) THEN
    CREATE UNIQUE INDEX newsletter_subscriptions_email_unique
      ON newsletter_subscriptions (lower(email));
  END IF;
END $$;
