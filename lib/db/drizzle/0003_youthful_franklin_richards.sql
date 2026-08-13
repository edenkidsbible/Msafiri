CREATE TABLE "pois" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"brand" text NOT NULL,
	"type" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"address" text NOT NULL,
	"hours" text,
	"status" text DEFAULT 'active' NOT NULL,
	"static_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"navigation_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashcam_clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"file_key" text NOT NULL,
	"duration_s" integer,
	"size_bytes" integer,
	"locked" boolean DEFAULT true NOT NULL,
	"lock_reason" text,
	"started_at" timestamp NOT NULL,
	"uploaded_at" timestamp,
	"lat" double precision,
	"lng" double precision,
	"speed_kmh" integer,
	"device_secret_hash" text,
	"vehicle_id" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp,
	"share_token" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dashcam_clips_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "dashcam_devices" (
	"device_id" text PRIMARY KEY NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashcam_enrollment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"otp_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"fulfilled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashcam_reg_ratelimit" (
	"ip_hash" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"window_start" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashcam_upload_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"clip_id" text NOT NULL,
	"file_key" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"fulfilled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dashcam_upload_intents_clip_id_unique" UNIQUE("clip_id")
);
--> statement-breakpoint
CREATE TABLE "emergency_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"name" text NOT NULL,
	"phone_e164" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "braking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"event_type" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"speed_kmh" real DEFAULT 0 NOT NULL,
	"g_force" real NOT NULL,
	"heading" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hazard_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"cluster_lat" double precision NOT NULL,
	"cluster_lng" double precision NOT NULL,
	"dominant_type" text NOT NULL,
	"device_count" integer NOT NULL,
	"event_count" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crash_trigger_events" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"lat" numeric,
	"lng" numeric,
	"peak_g" numeric NOT NULL,
	"sensitivity" text DEFAULT 'medium' NOT NULL,
	"triggered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emergency_alerts_log" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"lat" numeric,
	"lng" numeric,
	"contacts_sent" integer DEFAULT 0 NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accident_photos" (
	"id" text PRIMARY KEY NOT NULL,
	"accident_id" text NOT NULL,
	"category" text NOT NULL,
	"storage_url" text,
	"file_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accident_records" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"vehicle_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_manual" boolean DEFAULT false NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"lat" numeric,
	"lng" numeric,
	"road_name" text,
	"county" text,
	"nearby_landmark" text,
	"speed_before_kmh" numeric,
	"speed_at_impact_kmh" numeric,
	"heading_deg" numeric,
	"direction_label" text,
	"trip_start_at" timestamp,
	"destination_name" text,
	"distance_m" numeric,
	"duration_s" numeric,
	"weather_json" text,
	"dashcam_clip_id" text,
	"other_driver_json" text,
	"police_json" text,
	"driver_statement" text,
	"my_vehicle_json" text,
	"pdf_url" text,
	"pdf_file_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accident_timeline_events" (
	"id" text PRIMARY KEY NOT NULL,
	"accident_id" text NOT NULL,
	"event_type" text NOT NULL,
	"description" text,
	"occurred_at" timestamp NOT NULL,
	"metadata_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accident_witnesses" (
	"id" text PRIMARY KEY NOT NULL,
	"accident_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"make_name" text NOT NULL,
	"model_name" text NOT NULL,
	"make_slug" text NOT NULL,
	"model_slug" text NOT NULL,
	"known_make_id" text,
	"image_status" text DEFAULT 'pending' NOT NULL,
	"logo_status" text DEFAULT 'pending' NOT NULL,
	"submitted_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recovery_code" text,
	"device_id" text NOT NULL,
	"phone_number" text,
	"vehicles_json" text DEFAULT '[]' NOT NULL,
	"settings_json" text DEFAULT '{}' NOT NULL,
	"last_backup_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_backups_device_id_unique" UNIQUE("device_id")
);
--> statement-breakpoint
CREATE TABLE "shared_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_device_id" text NOT NULL,
	"plate_number" text,
	"display_name" text NOT NULL,
	"vehicle_type" text DEFAULT 'car' NOT NULL,
	"share_code" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shared_vehicles_share_code_unique" UNIQUE("share_code")
);
--> statement-breakpoint
CREATE TABLE "vehicle_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"requester_device_id" text NOT NULL,
	"requester_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "vehicle_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"member_device_id" text NOT NULL,
	"role" text DEFAULT 'driver' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"member_name" text,
	"removal_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text,
	"from_email" text NOT NULL,
	"from_name" text,
	"to_email" text NOT NULL,
	"subject" text DEFAULT '(no subject)' NOT NULL,
	"body_html" text,
	"body_text" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_replied" boolean DEFAULT false NOT NULL,
	"replied_at" timestamp with time zone,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"in_reply_to" text,
	"references" text,
	"spam_score" text,
	"raw_headers" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_emails_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "community_reports" ADD COLUMN "admin_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "community_reports" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "community_reports" ADD COLUMN "observation_context" text DEFAULT 'on_location' NOT NULL;--> statement-breakpoint
ALTER TABLE "community_reports" ADD COLUMN "observed_at" timestamp;--> statement-breakpoint
ALTER TABLE "community_reports" ADD COLUMN "reporter_proximity_m" integer;--> statement-breakpoint
ALTER TABLE "speed_zones" ADD COLUMN "bearing" integer;--> statement-breakpoint
ALTER TABLE "speed_zones" ADD COLUMN "static_id" text;--> statement-breakpoint
ALTER TABLE "speed_zones" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN "welcome_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN "last_reengaged_at" timestamp;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN "last_trip_notif_at" timestamp;--> statement-breakpoint
ALTER TABLE "app_releases" ADD COLUMN "scheduled_at" timestamp;--> statement-breakpoint
ALTER TABLE "sharing_sessions" ADD COLUMN "short_code" text;--> statement-breakpoint
ALTER TABLE "sharing_sessions" ADD COLUMN "driver_name" text;--> statement-breakpoint
ALTER TABLE "sharing_sessions" ADD COLUMN "live_activity_push_token" text;--> statement-breakpoint
ALTER TABLE "course_lessons" ADD COLUMN "audio_url" text;--> statement-breakpoint
ALTER TABLE "vehicle_join_requests" ADD CONSTRAINT "vehicle_join_requests_vehicle_id_shared_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."shared_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_members" ADD CONSTRAINT "vehicle_members_vehicle_id_shared_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."shared_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_members_vehicle_device_uniq" ON "vehicle_members" USING btree ("vehicle_id","member_device_id");--> statement-breakpoint
ALTER TABLE "sharing_sessions" ADD CONSTRAINT "sharing_sessions_short_code_unique" UNIQUE("short_code");