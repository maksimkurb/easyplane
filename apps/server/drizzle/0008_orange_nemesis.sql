ALTER TABLE "devices" ADD COLUMN "listen_port" integer;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "external_port" integer;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "public_ips" text[] DEFAULT '{}'::text[] NOT NULL;