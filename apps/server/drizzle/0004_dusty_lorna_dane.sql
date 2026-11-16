CREATE TYPE "public"."credential_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."device_role" AS ENUM('anchor', 'member');--> statement-breakpoint
CREATE TYPE "public"."network_access_mode" AS ENUM('shared_secret', 'credentials');--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"network_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"public_key" text NOT NULL,
	"groups" text[] DEFAULT '{}'::text[] NOT NULL,
	"allow_relay" boolean DEFAULT true NOT NULL,
	"allowed_proxy_cidrs" text[] DEFAULT '{}'::text[] NOT NULL,
	"reusable" boolean DEFAULT true NOT NULL,
	"expiry" timestamp with time zone NOT NULL,
	"status" "credential_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "role" "device_role" DEFAULT 'anchor' NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "role" "device_role" DEFAULT 'anchor' NOT NULL;--> statement-breakpoint
ALTER TABLE "networks" ADD COLUMN "access_mode" "network_access_mode" DEFAULT 'shared_secret' NOT NULL;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_device_uq" ON "credentials" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_network_credential_uq" ON "credentials" USING btree ("network_id","credential_id");--> statement-breakpoint
CREATE INDEX "credentials_network_status_idx" ON "credentials" USING btree ("network_id","status");--> statement-breakpoint
CREATE INDEX "credentials_expiry_idx" ON "credentials" USING btree ("expiry");