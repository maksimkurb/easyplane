ALTER TABLE "networks" ADD COLUMN "use_rendezvous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "networks" ADD COLUMN "p2p_only" boolean DEFAULT false NOT NULL;