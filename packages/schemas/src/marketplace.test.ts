import { describe, expect, it } from 'vitest';
import {
  createClassifiedSchema,
  createListingSchema,
  resolveDisputeSchema,
  setCommissionRuleSchema,
  vendorApplicationSchema,
} from './marketplace';

const id = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const application = {
  name: 'Bright Plumbing',
  type: 'company',
  description: 'Plumbing repairs and installations',
  contactEmail: 'ops@brightplumbing.ng',
  categoryIds: [id],
  serviceAreas: [{ state: 'Lagos' }],
};

describe('vendorApplicationSchema', () => {
  it('needs a CAC number for companies only', () => {
    expect(vendorApplicationSchema.safeParse(application).success).toBe(false);
    expect(
      vendorApplicationSchema.safeParse({ ...application, cacNumber: 'RC 123456' }).success,
    ).toBe(true);
    expect(vendorApplicationSchema.safeParse({ ...application, type: 'individual' }).success).toBe(
      true,
    );
  });

  it('needs a state or an estate for every service area', () => {
    const parsed = vendorApplicationSchema.safeParse({
      ...application,
      type: 'individual',
      serviceAreas: [{ lga: 'Ikeja' }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('createListingSchema', () => {
  const listing = {
    categoryId: id,
    title: 'Leak repair',
    description: 'Fix leaking taps and pipes',
  };
  it('needs a price unless priced on quote', () => {
    expect(createListingSchema.safeParse({ ...listing, priceType: 'fixed' }).success).toBe(false);
    expect(createListingSchema.safeParse({ ...listing, priceType: 'quote' }).success).toBe(true);
    expect(
      createListingSchema.safeParse({ ...listing, priceType: 'from', priceKobo: 500_000 }).success,
    ).toBe(true);
  });

  it('rejects fractional kobo', () => {
    expect(
      createListingSchema.safeParse({ ...listing, priceType: 'fixed', priceKobo: 10.5 }).success,
    ).toBe(false);
  });
});

describe('setCommissionRuleSchema', () => {
  it('ties scopeId to the scope and caps commission at 30%', () => {
    expect(setCommissionRuleSchema.safeParse({ scope: 'default', bps: 500 }).success).toBe(true);
    expect(setCommissionRuleSchema.safeParse({ scope: 'category', bps: 500 }).success).toBe(false);
    expect(
      setCommissionRuleSchema.safeParse({ scope: 'default', scopeId: id, bps: 500 }).success,
    ).toBe(false);
    expect(setCommissionRuleSchema.safeParse({ scope: 'default', bps: 3001 }).success).toBe(false);
  });
});

describe('resolveDisputeSchema', () => {
  it('needs an amount for a partial refund', () => {
    expect(
      resolveDisputeSchema.safeParse({ resolution: 'partial_refund', note: 'Half done' }).success,
    ).toBe(false);
    expect(
      resolveDisputeSchema.safeParse({ resolution: 'refund', note: 'Not delivered' }).success,
    ).toBe(true);
  });
});

describe('createClassifiedSchema', () => {
  it('defaults to not negotiable with no photos', () => {
    const parsed = createClassifiedSchema.parse({
      kind: 'item',
      title: 'Standing fan',
      description: 'Barely used standing fan',
    });
    expect(parsed.negotiable).toBe(false);
    expect(parsed.photoFileIds).toEqual([]);
  });
});
