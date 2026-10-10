-- Date-only polls (additive, safe on prod; no data is converted).
-- Existing polls become legacy timed polls ('datetime'); new rows default to 'date'.
ALTER TABLE "events" ADD COLUMN "mode" VARCHAR(16) NOT NULL DEFAULT 'datetime';
ALTER TABLE "events" ALTER COLUMN "mode" SET DEFAULT 'date';

-- Date options: calendar date without time zone; timed columns only used by legacy polls.
ALTER TABLE "time_options" ADD COLUMN "date" DATE;
ALTER TABLE "time_options" ALTER COLUMN "start_at" DROP NOT NULL;

-- One option per date per poll (NULLs – legacy rows – never conflict).
CREATE UNIQUE INDEX "time_options_event_id_date_key" ON "time_options"("event_id", "date");
