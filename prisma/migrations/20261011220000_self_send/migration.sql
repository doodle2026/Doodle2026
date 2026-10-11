-- "Send til mig selv" (additive)
CREATE TABLE "self_sends" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "email_hash" CHAR(64) NOT NULL,
    "ip_hash" CHAR(64) NOT NULL,
    "link_token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "self_sends_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "self_sends_link_token_hash_key" ON "self_sends"("link_token_hash");
CREATE INDEX "self_sends_event_id_created_at_idx" ON "self_sends"("event_id", "created_at");
CREATE INDEX "self_sends_ip_hash_created_at_idx" ON "self_sends"("ip_hash", "created_at");
ALTER TABLE "self_sends" ADD CONSTRAINT "self_sends_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
