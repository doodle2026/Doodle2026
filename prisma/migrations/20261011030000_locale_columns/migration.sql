-- i18n phase 4: language of polls, participants and invitations. Additive; the default only fills existing rows
-- (prod is empty) and is dropped right away so the app must always set it.
ALTER TABLE "events" ADD COLUMN "locale" VARCHAR(5) NOT NULL DEFAULT 'da';
ALTER TABLE "participants" ADD COLUMN "locale" VARCHAR(5) NOT NULL DEFAULT 'da';
ALTER TABLE "invitations" ADD COLUMN "locale" VARCHAR(5) NOT NULL DEFAULT 'da';
ALTER TABLE "events" ALTER COLUMN "locale" DROP DEFAULT;
ALTER TABLE "participants" ALTER COLUMN "locale" DROP DEFAULT;
ALTER TABLE "invitations" ALTER COLUMN "locale" DROP DEFAULT;
