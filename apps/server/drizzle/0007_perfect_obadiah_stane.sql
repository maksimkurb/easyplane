CREATE TYPE "public"."policy_mode" AS ENUM('open', 'rules', 'json');--> statement-breakpoint
CREATE TYPE "public"."user_group_source" AS ENUM('manual', 'oidc');--> statement-breakpoint
CREATE TABLE "user_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" "user_group_source" DEFAULT 'manual' NOT NULL,
	"oidc_value" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "networks" ADD COLUMN "policy_mode" "policy_mode" DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_group_id_user_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_group_members_group_email_uq" ON "user_group_members" USING btree ("group_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_groups_org_name_uq" ON "user_groups" USING btree ("org_id","name");--> statement-breakpoint
UPDATE "networks" SET "policy_mode" = 'rules' WHERE "policy_version" > 0;
