-- Participants: case-insensitive unique name per poll, lookup by edit-token hash
ALTER TABLE "participants" ADD COLUMN "name_key" TEXT;
-- Backfill pre-existing rows (none expected: there was no voting API) with a guaranteed-unique key.
UPDATE "participants" SET "name_key" = lower(btrim("name")) || '#' || "id" WHERE "name_key" IS NULL;
ALTER TABLE "participants" ALTER COLUMN "name_key" SET NOT NULL;
CREATE UNIQUE INDEX "participants_edit_token_hash_key" ON "participants"("edit_token_hash");
CREATE UNIQUE INDEX "participants_event_id_name_key_key" ON "participants"("event_id", "name_key");

-- Idempotent vote submit
CREATE TABLE "vote_idempotency_keys" (
    "key_hash" CHAR(64) NOT NULL,
    "participant_id" INTEGER NOT NULL,
    "edit_token_enc" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vote_idempotency_keys_pkey" PRIMARY KEY ("key_hash")
);
CREATE INDEX "vote_idempotency_keys_participant_id_idx" ON "vote_idempotency_keys"("participant_id");
ALTER TABLE "vote_idempotency_keys" ADD CONSTRAINT "vote_idempotency_keys_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
