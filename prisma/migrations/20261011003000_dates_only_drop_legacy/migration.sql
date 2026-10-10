-- Date-only: drop legacy timed polls' columns. Robust for a prod DB with a few test rows; no reset needed.
-- 0) The (event_id, date) unique index would block filling colliding dates; rebuilt in step 4.
DROP INDEX IF EXISTS "time_options_event_id_date_key";

-- 1) Fill missing dates from the old start time (Copenhagen calendar day).
UPDATE "time_options" SET "date" = ("start_at" AT TIME ZONE 'Europe/Copenhagen')::date
WHERE "date" IS NULL AND "start_at" IS NOT NULL;

-- 2) Options without any date/time can't be kept.
DELETE FROM "votes" WHERE "time_option_id" IN (SELECT "id" FROM "time_options" WHERE "date" IS NULL);
DELETE FROM "time_options" WHERE "date" IS NULL;

-- 3) Collisions (same poll, same date): keep the lowest id, delete the others and their votes;
--    a chosen duplicate is repointed to the kept option.
CREATE TEMP TABLE "_dup_options" AS
SELECT o."id", k."keep_id"
FROM "time_options" o
JOIN (SELECT "event_id", "date", MIN("id") AS "keep_id" FROM "time_options" GROUP BY "event_id", "date") k
  ON k."event_id" = o."event_id" AND k."date" = o."date"
WHERE o."id" <> k."keep_id";
UPDATE "events" e SET "chosen_option_id" = d."keep_id"
FROM "_dup_options" d WHERE e."chosen_option_id" = d."id";
DELETE FROM "votes" WHERE "time_option_id" IN (SELECT "id" FROM "_dup_options");
DELETE FROM "time_options" WHERE "id" IN (SELECT "id" FROM "_dup_options");
DROP TABLE "_dup_options";

-- 4) Lock it in.
ALTER TABLE "time_options" ALTER COLUMN "date" SET NOT NULL;
CREATE UNIQUE INDEX "time_options_event_id_date_key" ON "time_options"("event_id", "date");
ALTER TABLE "time_options" DROP COLUMN "start_at", DROP COLUMN "end_at";
ALTER TABLE "events" DROP COLUMN "mode";
