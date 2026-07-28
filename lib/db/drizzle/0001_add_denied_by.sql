ALTER TABLE "community_reports" ADD COLUMN "denied_by" jsonb DEFAULT '[]'::jsonb NOT NULL;
