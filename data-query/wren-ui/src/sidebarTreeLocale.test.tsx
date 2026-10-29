import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Acceptance batch 5: the modeling sidebar kept its Chinese group titles after the
// embedded page switched its Next locale to English, because each tree is cached
// in state and its rebuild effect did not depend on the locale. Effects do not
// run in a server render, so record every effect's dependency list instead.
const effectDeps: unknown[][] = [];
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useEffect: (effect: () => void, deps?: unknown[]) => {
      if (deps) effectDeps.push(deps);
      return actual.useEffect(effect, deps);
    },
  };
});
let mockLocale = 'zh-CN';
jest.mock('next/router', () => ({
  useRouter: () => ({ locale: mockLocale, push: jest.fn() }),
}));
jest.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/components/sidebar/Modeling', () => ({
  StyledSidebarTree: (props: any) => (
    <div>
      {props.treeData.map((node: any) => (
        <div key={node.key}>{node.title}</div>
      ))}
    </div>
  ),
}));
jest.mock('@/utils/kailoHost', () => ({ confirm: jest.fn(), notify: {} }));

import ViewTree from './components/sidebar/modeling/ViewTree';
import { kailoText } from './utils/kailoI18n';

describe('modeling sidebar follows the page locale', () => {
  beforeEach(() => {
    effectDeps.length = 0;
  });

  test.each(['zh-CN', 'en'])('renders the %s group title', (locale) => {
    mockLocale = locale;
    const html = renderToStaticMarkup(<ViewTree views={[]} />);
    expect(html).toContain(kailoText(locale, 'modeling.views'));
  });

  test('the cached tree is rebuilt when only the locale changes', () => {
    const views: any[] = [];
    mockLocale = 'zh-CN';
    renderToStaticMarkup(<ViewTree views={views} />);
    const zh = effectDeps.find((deps) => deps.includes(views));
    effectDeps.length = 0;
    mockLocale = 'en';
    renderToStaticMarkup(<ViewTree views={views} />);
    const en = effectDeps.find((deps) => deps.includes(views));
    expect(zh).toBeDefined();
    expect(en).toBeDefined();
    // Same data, different locale: React re-runs the effect only if a dependency differs.
    expect(zh!.some((dep, i) => !Object.is(dep, en![i]))).toBe(true);
  });
});
