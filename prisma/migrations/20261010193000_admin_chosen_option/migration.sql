-- AlterTable
ALTER TABLE "events" ADD COLUMN "chosen_option_id" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "events_chosen_option_id_key" ON "events"("chosen_option_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_chosen_option_id_fkey" FOREIGN KEY ("chosen_option_id") REFERENCES "time_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;
