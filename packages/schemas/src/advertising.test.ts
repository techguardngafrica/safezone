import { describe, expect, it } from 'vitest';
import {
  adCategoryPolicySchema,
  adTargetingSchema,
  arconListQuerySchema,
  createAdCampaignSchema,
  createAdCreativeSchema,
  createAdEnquirySchema,
  platformAdCreativeListQuerySchema,
  platformAdInvoiceListQuerySchema,
  reviewAdCreativeSchema,
} from './advertising';
import { createDpiaRecordSchema, updateDpiaRecordSchema } from './platform-admin';

const id = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('advertising schemas', () => {
  it('needs consent on enquiries', () => {
    const enquiry = {
      advertiserType: 'organisation',
      contactName: 'Ngozi',
      phone: '08031234567',
      email: 'ngozi@example.ng',
      category: 'retail',
      objectives: 'Store opening',
      description: 'New supermarket near the estates in Lekki',
      budgetRange: '100k_500k',
    };
    expect(createAdEnquirySchema.safeParse(enquiry).success).toBe(false);
    expect(createAdEnquirySchema.safeParse({ ...enquiry, consent: true }).success).toBe(true);
  });

  it('ties targeting lists to their scope', () => {
    expect(adTargetingSchema.safeParse({ scope: 'estates' }).success).toBe(false);
    expect(adTargetingSchema.safeParse({ scope: 'states', states: ['Lagos'] }).success).toBe(true);
    expect(adTargetingSchema.safeParse({ scope: 'all' }).success).toBe(true);
  });

  it('needs the end after the start', () => {
    const base = {
      advertiserId: id,
      title: 'Opening week',
      objective: 'Awareness',
      budgetKobo: 50_000_000,
      lineItems: [{ placementKey: 'resident.home.banner', targeting: { scope: 'all' } }],
    };
    expect(
      createAdCampaignSchema.safeParse({
        ...base,
        startsAt: '2026-12-10T00:00:00+01:00',
        endsAt: '2026-12-01T00:00:00+01:00',
      }).success,
    ).toBe(false);
  });

  it('needs https destinations and images for image formats', () => {
    const creative = {
      type: 'image_banner',
      headline: 'Fresh bread',
      cta: 'Visit',
      imageFileId: id,
    };
    expect(
      createAdCreativeSchema.safeParse({ ...creative, destinationUrl: 'http://shop.ng' }).success,
    ).toBe(false);
    expect(
      createAdCreativeSchema.safeParse({ ...creative, destinationUrl: 'https://shop.ng' }).success,
    ).toBe(true);
    const { imageFileId: _drop, ...noImage } = creative;
    expect(
      createAdCreativeSchema.safeParse({ ...noImage, destinationUrl: 'https://shop.ng' }).success,
    ).toBe(false);
  });

  it('needs notes when a creative is not approved', () => {
    expect(reviewAdCreativeSchema.safeParse({ decision: 'rejected' }).success).toBe(false);
    expect(reviewAdCreativeSchema.safeParse({ decision: 'approved' }).success).toBe(true);
  });

  it('validates platform advertising desk queries and category policies', () => {
    expect(platformAdCreativeListQuerySchema.safeParse({ reviewStatus: 'pending' }).success).toBe(
      true,
    );
    expect(platformAdInvoiceListQuerySchema.safeParse({ status: 'paid' }).success).toBe(true);
    expect(arconListQuerySchema.safeParse({ hasRef: 'yes', q: 'ARCON' }).success).toBe(true);
    expect(
      adCategoryPolicySchema.safeParse({
        category: 'tobacco',
        policy: 'prohibited',
        locked: true,
        notes: 'Permanently prohibited.',
      }).success,
    ).toBe(true);
  });

  it('validates DPIA create and update schemas', () => {
    expect(
      createDpiaRecordSchema.safeParse({
        title: 'SOS location processing',
        processingActivity: 'Capture GPS location during active SOS alerts only',
        riskLevel: 'high',
        mitigations: 'Stop collection immediately on resolution; strict RLS and audit trail',
      }).success,
    ).toBe(true);
    expect(
      createDpiaRecordSchema.safeParse({
        title: 'No',
        processingActivity: 'Short',
        riskLevel: 'high',
        mitigations: 'Short',
      }).success,
    ).toBe(false);
    expect(updateDpiaRecordSchema.safeParse({ status: 'approved' }).success).toBe(true);
  });
});
