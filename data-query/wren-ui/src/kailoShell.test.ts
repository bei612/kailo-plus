import { headerAccount } from './utils/kailoShell';
import { kailoText } from './utils/kailoI18n';

// DD-138 §2: identity and sign-out are Kailo surfaces.
describe('header account (DD-138)', () => {
  it('shows nothing inside the Kailo frame', () => {
    expect(headerAccount(true, true)).toBe('none');
    expect(headerAccount(true, false)).toBe('none');
  });

  it('shows only a read-only identity on top-level visits', () => {
    expect(headerAccount(false, true)).toBe('identity');
    expect(headerAccount(false, false)).toBe('none');
  });
});

describe('not-found copy (DD-133 §1)', () => {
  it('is localized in both Kailo locales without upstream naming', () => {
    for (const locale of ['zh-CN', 'en']) {
      for (const key of [
        'notFoundTitle',
        'notFoundDescription',
        'backToHome',
      ] as const) {
        const text = kailoText(locale, key);
        expect(text).toBeTruthy();
        expect(text).not.toMatch(/wren/i);
      }
    }
    expect(kailoText('zh-CN', 'notFoundTitle')).toBe('页面不存在');
    expect(kailoText('en', 'notFoundTitle')).toBe('Page not found');
  });
});
