-- Owner dashboard stats (additive only).
ALTER TABLE "owner_login_log" ADD COLUMN "event_slug" VARCHAR(22);
CREATE INDEX "owner_login_log_at_idx" ON "owner_login_log"("at");

CREATE TABLE "daily_stats" (
  "day" CHAR(10) NOT NULL,
  "key" VARCHAR(32) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "daily_stats_pkey" PRIMARY KEY ("day", "key")
);

-- Email search (ILIKE '%q%') on invitations.email: trigram index if the extension is available (Supabase has it).
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXECUTE 'CREATE INDEX IF NOT EXISTS invitations_email_trgm_idx ON invitations USING gin (email gin_trgm_ops)';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_trgm not available – email search uses a sequential scan';
END $$;
