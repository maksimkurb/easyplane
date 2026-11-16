ALTER TABLE "device_routes" ADD COLUMN "source" text DEFAULT 'panel' NOT NULL;--> statement-breakpoint
ALTER TABLE "device_routes" ADD COLUMN "last_declared_at" timestamp with time zone;