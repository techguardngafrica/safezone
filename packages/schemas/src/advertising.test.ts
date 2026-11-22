import { describe, expect, it } from 'vitest';
import {
  adTargetingSchema,
  createAdCampaignSchema,
  createAdCreativeSchema,
  createAdEnquirySchema,
  reviewAdCreativeSchema,
} from './advertising';

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
});
