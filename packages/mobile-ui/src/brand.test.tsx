import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

import { BrandLogo, BrandMark } from './brand';

describe('mobile BrandMark and BrandLogo', () => {
  it('creates BrandMark and BrandLogo elements with brand tokens', () => {
    const mark = BrandMark({ size: 36, tone: 'brand', label: 'Safezone' });
    expect(mark).toBeTruthy();

    const logo = BrandLogo({ name: 'Safezone', subtitle: 'Security', large: true });
    expect(logo).toBeTruthy();
  });
});
