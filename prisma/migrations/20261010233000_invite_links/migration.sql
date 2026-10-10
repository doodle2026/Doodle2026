-- AlterTable
ALTER TABLE "events" ADD COLUMN     "invite_tracking" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "invite_gen" INTEGER,
ADD COLUMN     "invite_token_hash" CHAR(64),
ADD COLUMN     "linked_manually" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "participant_id" INTEGER,
ADD COLUMN     "revoked_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_invite_token_hash_key" ON "invitations"("invite_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_participant_id_key" ON "invitations"("participant_id");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

