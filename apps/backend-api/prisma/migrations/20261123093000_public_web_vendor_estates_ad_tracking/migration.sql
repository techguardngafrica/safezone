-- Allow vendors to read their own estate approvals under the marketplace context.
CREATE INDEX "estate_vendor_approvals_vendor_id_status_idx"
  ON "tenant"."estate_vendor_approvals"("vendor_id", "status");

CREATE POLICY "estate_vendor_approvals_vendor"
  ON "tenant"."estate_vendor_approvals"
  FOR SELECT TO safezone_app
  USING (
    current_setting('app.context', true) = 'marketplace'
    AND vendor_id = nullif(current_setting('app.vendor_id', true), '')::uuid
  );

-- Unguessable link-based status lookup for advertising enquiries (SHA-256 hash only).
ALTER TABLE "platform"."ad_enquiries"
  ADD COLUMN "tracking_token_hash" TEXT;

CREATE UNIQUE INDEX "ad_enquiries_tracking_token_hash_key"
  ON "platform"."ad_enquiries"("tracking_token_hash")
  WHERE "tracking_token_hash" IS NOT NULL;
