CREATE TABLE "wireguard_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"network_id" uuid NOT NULL,
	"hub_device_id" uuid NOT NULL,
	"name" text NOT NULL,
	"virtual_ipv4" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"owner_user_id" uuid,
	"reported_status" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reported_status_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "wg_listen_port" integer;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "wg_private_key_ciphertext" text;--> statement-breakpoint
ALTER TABLE "wireguard_clients" ADD CONSTRAINT "wireguard_clients_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wireguard_clients" ADD CONSTRAINT "wireguard_clients_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wireguard_clients" ADD CONSTRAINT "wireguard_clients_hub_device_id_devices_id_fk" FOREIGN KEY ("hub_device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wireguard_clients" ADD CONSTRAINT "wireguard_clients_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wireguard_clients_network_name_uq" ON "wireguard_clients" USING btree ("network_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "wireguard_clients_network_ip_uq" ON "wireguard_clients" USING btree ("network_id","virtual_ipv4");--> statement-breakpoint
CREATE INDEX "wireguard_clients_network_idx" ON "wireguard_clients" USING btree ("network_id");--> statement-breakpoint
CREATE INDEX "wireguard_clients_hub_idx" ON "wireguard_clients" USING btree ("hub_device_id");