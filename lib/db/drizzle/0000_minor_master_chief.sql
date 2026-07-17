CREATE TABLE "blocked_devices" (
	"device_id" text PRIMARY KEY NOT NULL,
	"reason" text,
	"blocked_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"device_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"confirm_count" integer DEFAULT 1 NOT NULL,
	"confirmed_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deny_count" integer DEFAULT 0 NOT NULL,
	"speed_limit" integer,
	"road_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"last_notified_at" timestamp,
	"last_voted_at" timestamp,
	"notified_tokens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"moderation_dismissed" boolean DEFAULT false NOT NULL,
	"flag_count" integer DEFAULT 0 NOT NULL,
	"flagged_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"flag_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"flag_dismissed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"type" text DEFAULT 'info' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"permissions" text,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"password_updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "speed_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"road" text,
	"type" text NOT NULL,
	"mode" text DEFAULT 'point' NOT NULL,
	"speed_limit" integer,
	"description" text,
	"lat" double precision,
	"lng" double precision,
	"start_lat" double precision,
	"start_lng" double precision,
	"end_lat" double precision,
	"end_lng" double precision,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data_json" text,
	"type" text DEFAULT 'broadcast' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp,
	"sent_at" timestamp,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"target_count" integer,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" text DEFAULT 'unknown' NOT NULL,
	"last_lat" real,
	"last_lng" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_tokens_device_id_unique" UNIQUE("device_id")
);
--> statement-breakpoint
CREATE TABLE "app_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"build_number" integer DEFAULT 1 NOT NULL,
	"platform" text DEFAULT 'all' NOT NULL,
	"release_type" text DEFAULT 'patch' NOT NULL,
	"release_notes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_force_update" boolean DEFAULT false NOT NULL,
	"store_url_ios" text,
	"store_url_android" text,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "blog_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"content" text DEFAULT '' NOT NULL,
	"author" text DEFAULT 'Msafiri Team' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"featured_image" text,
	"meta_title" text,
	"meta_description" text,
	"keywords" text[],
	"read_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_posts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "planned_trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"saved_place_id" uuid,
	"label" text NOT NULL,
	"dest_lat" double precision NOT NULL,
	"dest_lng" double precision NOT NULL,
	"planned_at" timestamp NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"notified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'custom' NOT NULL,
	"address" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"usual_time_minutes" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"platform" text,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"code" text NOT NULL,
	"application_id" uuid,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sharing_sessions" (
	"token" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"destination_name" text,
	"destination_lat" double precision,
	"destination_lng" double precision,
	"lat" double precision,
	"lng" double precision,
	"speed_kmh" double precision,
	"duration_remaining_s" integer,
	"distance_remaining_m" double precision,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_ping_at" timestamp,
	"ended_at" timestamp,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_chapters_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "course_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"chapter_id" uuid NOT NULL,
	"title" text NOT NULL,
	"order" integer NOT NULL,
	"estimated_minutes" integer DEFAULT 5 NOT NULL,
	"content" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"key_points" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_lessons_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "course_quiz_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"question" text NOT NULL,
	"options" text[] NOT NULL,
	"correct_index" integer NOT NULL,
	"order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_course_bookmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"lesson_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_bookmark_device_lesson" UNIQUE("device_id","lesson_id")
);
--> statement-breakpoint
CREATE TABLE "user_course_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"lesson_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"quiz_score" integer,
	CONSTRAINT "uq_progress_device_lesson" UNIQUE("device_id","lesson_id")
);
--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_application_id_creator_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."creator_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_chapter_id_course_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."course_chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_quiz_questions" ADD CONSTRAINT "course_quiz_questions_lesson_id_course_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."course_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_course_bookmarks" ADD CONSTRAINT "user_course_bookmarks_lesson_id_course_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."course_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_course_progress" ADD CONSTRAINT "user_course_progress_lesson_id_course_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."course_lessons"("id") ON DELETE cascade ON UPDATE no action;