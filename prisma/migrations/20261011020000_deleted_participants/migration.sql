-- P1: remember edit-token hashes of participants deleted by the organizer (additive).
CREATE TABLE "deleted_participants" (
    "edit_token_hash" CHAR(64) NOT NULL,
    "event_id" INTEGER NOT NULL,
    "deleted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deleted_participants_pkey" PRIMARY KEY ("edit_token_hash")
);
CREATE INDEX "deleted_participants_event_id_idx" ON "deleted_participants"("event_id");
ALTER TABLE "deleted_participants" ADD CONSTRAINT "deleted_participants_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
