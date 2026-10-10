-- AlterTable
ALTER TABLE "events" ADD COLUMN     "last_reminder_at" TIMESTAMPTZ(3),
ADD COLUMN     "mail_blocked_at" TIMESTAMPTZ(3),
ADD COLUMN     "organizer_name" VARCHAR(100),
ADD COLUMN     "reminders_sent" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "invitations" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "name" VARCHAR(100),
    "delivery" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "reason" VARCHAR(200),
    "provider_id" VARCHAR(64),
    "link_token_hash" CHAR(64) NOT NULL,
    "last_event_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "email_hash" CHAR(64) NOT NULL,
    "scope" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("email_hash","scope")
);

-- CreateTable
CREATE TABLE "email_quota" (
    "day" CHAR(10) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "email_quota_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "abuse_reports" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER,
    "reason" VARCHAR(32) NOT NULL,
    "details" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abuse_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_provider_id_key" ON "invitations"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_link_token_hash_key" ON "invitations"("link_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_event_id_email_key" ON "invitations"("event_id", "email");

-- CreateIndex
CREATE INDEX "abuse_reports_event_id_idx" ON "abuse_reports"("event_id");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
