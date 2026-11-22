-- schema.prisma declares these columns with @updatedAt (Prisma sets the value), so the database
-- default added in 20261121120000_platform_control_plane was drift. Dropping it is safe: every write
-- goes through Prisma, which always supplies updated_at.
ALTER TABLE "platform"."breach_log" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "platform"."data_subject_requests" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "platform"."support_tickets" ALTER COLUMN "updated_at" DROP DEFAULT;
