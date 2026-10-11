-- Owner dashboard auth (additive only).
CREATE TABLE "owner_users" (
  "id" SERIAL NOT NULL,
  "username" VARCHAR(64) NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_login_at" TIMESTAMPTZ(3),
  CONSTRAINT "owner_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "owner_users_username_key" ON "owner_users"("username");

CREATE TABLE "owner_sessions" (
  "id_hash" CHAR(64) NOT NULL,
  "user_id" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "owner_sessions_pkey" PRIMARY KEY ("id_hash")
);
CREATE INDEX "owner_sessions_user_id_idx" ON "owner_sessions"("user_id");
CREATE INDEX "owner_sessions_expires_at_idx" ON "owner_sessions"("expires_at");
ALTER TABLE "owner_sessions" ADD CONSTRAINT "owner_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "owner_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "owner_login_log" (
  "id" SERIAL NOT NULL,
  "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "username" VARCHAR(64) NOT NULL,
  "user_id" INTEGER,
  "success" BOOLEAN NOT NULL,
  "outcome" VARCHAR(24) NOT NULL,
  "ip" VARCHAR(64) NOT NULL,
  "user_agent" VARCHAR(255) NOT NULL,
  CONSTRAINT "owner_login_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "owner_login_log_ip_at_idx" ON "owner_login_log"("ip", "at");
CREATE INDEX "owner_login_log_username_at_idx" ON "owner_login_log"("username", "at");
