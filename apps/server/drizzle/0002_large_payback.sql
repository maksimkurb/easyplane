CREATE TABLE "network_peers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"network_id" uuid NOT NULL,
	"device_id" uuid,
	"url" text,
	"position" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "advertised_endpoints" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "is_hub" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "network_peers" ADD CONSTRAINT "network_peers_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_peers" ADD CONSTRAINT "network_peers_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_peers" ADD CONSTRAINT "network_peers_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_peers" ADD CONSTRAINT "network_peers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "network_peers_position_uq" ON "network_peers" USING btree ("network_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "network_peers_device_uq" ON "network_peers" USING btree ("network_id","device_id") WHERE "network_peers"."url" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "network_peers_raw_uq" ON "network_peers" USING btree ("network_id","url") WHERE "network_peers"."url" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "network_peers_network_idx" ON "network_peers" USING btree ("network_id");
--> statement-breakpoint
-- Data migration (hub peer model): every `peerUrls` string that existed before
-- this migration becomes a raw network peer entry, so nothing is lost and the
-- same URLs are still pushed. Sources are the network default config (the list
-- that used to be broadcast to every device) and any per-revision list an
-- operator set by hand. Entries are deduplicated per network by URL (trailing
-- slashes ignored) and keep a deterministic order: network defaults first, then
-- revision lists by creation time.
--
-- They become raw entries because no device advertised endpoints yet. An admin
-- links an entry to a device from the network page once that device advertises
-- its endpoint; the entry then turns device-backed and the owning device stops
-- receiving (and dialling) its own URL.
WITH raw AS (
	SELECT
		n.id AS network_id,
		n.org_id,
		btrim(COALESCE(entry.value #>> '{}', '')) AS url,
		0 AS source_rank,
		n.created_at AS seen_at,
		entry.ord
	FROM networks n
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE
			WHEN jsonb_typeof(n.default_config -> 'peerUrls') = 'array'
			THEN n.default_config -> 'peerUrls'
			ELSE '[]'::jsonb
		END
	) WITH ORDINALITY AS entry(value, ord)
	UNION ALL
	SELECT
		r.network_id,
		r.org_id,
		btrim(COALESCE(entry.value #>> '{}', '')),
		1,
		r.created_at,
		entry.ord
	FROM config_revisions r
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE
			WHEN jsonb_typeof(r.config -> 'peerUrls') = 'array'
			THEN r.config -> 'peerUrls'
			ELSE '[]'::jsonb
		END
	) WITH ORDINALITY AS entry(value, ord)
),
deduped AS (
	SELECT DISTINCT ON (network_id, regexp_replace(url, '/+$', ''))
		network_id,
		org_id,
		url,
		source_rank,
		seen_at,
		ord
	FROM raw
	WHERE url <> ''
	ORDER BY network_id, regexp_replace(url, '/+$', ''), source_rank, seen_at, ord
),
ordered AS (
	SELECT
		network_id,
		org_id,
		url,
		row_number() OVER (
			PARTITION BY network_id
			ORDER BY source_rank, seen_at, ord, url
		) - 1 AS position
	FROM deduped
)
INSERT INTO network_peers (org_id, network_id, device_id, url, position)
SELECT org_id, network_id, NULL, url, position
FROM ordered;
