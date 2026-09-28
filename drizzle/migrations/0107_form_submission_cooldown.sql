-- Adds form_submission_cooldown: a short, cross-form, per-email dedup window for the
-- public contact/newsletter/membership-application forms (public form spam
-- hardening, docs/work-log/2026-09-28-public-form-spam.md).
--
-- Catches the observed attack shape: one harvested email address hitting all three
-- forms within ~30 seconds, each individually capable of passing Turnstile, the
-- honeypot, and the timing floor.
--
-- A dedicated table (not a query against contact_submissions /
-- newsletter_subscriptions / membership_applications) per the 2026-09-28
-- architectural review — see that review's "Cooldown storage" ruling for the
-- reasoning.
--
-- TIMESTAMPTZ: a genuine instant compared against now() for staleness, same
-- rationale as email_queue.retrying_at (0106).
--
-- No PII: email is the submitter's own address, already stored in the
-- corresponding content table (contact_submissions.email etc.) — this table adds
-- no new personal data, only a timestamp index on data already being written
-- elsewhere.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS are safe to
-- re-run on every deploy.

CREATE TABLE IF NOT EXISTS form_submission_cooldown (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_form_submission_cooldown_email_created
  ON form_submission_cooldown (email, created_at);
