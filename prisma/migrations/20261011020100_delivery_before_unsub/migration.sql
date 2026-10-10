-- E1: keep the delivery state across unsubscribe → resubscribe (additive, nullable).
ALTER TABLE "invitations" ADD COLUMN "delivery_before_unsub" VARCHAR(16);
