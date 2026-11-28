import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandLogo, BrandMark } from './brand';

describe('BrandMark and BrandLogo', () => {
  it('renders decorative BrandMark by default and accessible img when label is provided', () => {
    const decorative = renderToStaticMarkup(<BrandMark />);
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).toContain('#254D42');
    expect(decorative).toContain('#E5D8C7');

    const labelled = renderToStaticMarkup(<BrandMark label="Safezone" tone="inverse" />);
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Safezone"');
  });

  it('renders BrandLogo with wordmark and optional surface subtitle', () => {
    const html = renderToStaticMarkup(<BrandLogo name="Safezone" subtitle="Admin" />);
    expect(html).toContain('Safezone');
    expect(html).toContain('Admin');
  });
});
