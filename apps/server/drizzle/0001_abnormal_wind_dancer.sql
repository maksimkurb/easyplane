CREATE TYPE "public"."device_route_kind" AS ENUM('subnet', 'exit_node');--> statement-breakpoint
CREATE TYPE "public"."device_route_state" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."revision_source" ADD VALUE 'policy';--> statement-breakpoint
CREATE TABLE "device_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"network_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"kind" "device_route_kind" NOT NULL,
	"cidr" text DEFAULT '' NOT NULL,
	"state" "device_route_state" DEFAULT 'pending' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"network_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "config_revisions" ADD COLUMN "policy_version" integer;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "dns_name" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "reported_state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "reported_state_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "networks" ADD COLUMN "magic_dns_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "networks" ADD COLUMN "magic_dns_zone" text DEFAULT 'et.net.' NOT NULL;--> statement-breakpoint
ALTER TABLE "networks" ADD COLUMN "policy_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "groups" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "device_routes" ADD CONSTRAINT "device_routes_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_routes" ADD CONSTRAINT "device_routes_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_routes" ADD CONSTRAINT "device_routes_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_routes" ADD CONSTRAINT "device_routes_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_routes" ADD CONSTRAINT "device_routes_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_policies" ADD CONSTRAINT "network_policies_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_policies" ADD CONSTRAINT "network_policies_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_policies" ADD CONSTRAINT "network_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_routes_uq" ON "device_routes" USING btree ("device_id","kind","cidr");--> statement-breakpoint
CREATE INDEX "device_routes_network_idx" ON "device_routes" USING btree ("network_id");--> statement-breakpoint
CREATE INDEX "device_routes_state_idx" ON "device_routes" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "network_policies_network_version_uq" ON "network_policies" USING btree ("network_id","version");--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_network_dns_name_uq" ON "devices" USING btree ("network_id",lower("dns_name"));