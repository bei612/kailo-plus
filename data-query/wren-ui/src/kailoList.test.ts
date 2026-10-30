import {
  clampPage,
  classifyLoadError,
  isReadOperation,
  listDensityOf,
  matchesSearch,
  nextQuery,
  pageCount,
  pageItems,
  readPaging,
  rowHeight,
  slicePage,
  usageRefusalKey,
} from './utils/kailoList';
import { kailoText } from './utils/kailoI18n';
import {
  chartPalette,
  hslOf,
  kailoChartConfig,
  shiftLightness,
} from './components/chart/theme';

// DD-167 (`20` §15.3/§15.4): paging, route state and read failures.
describe('list paging (20 §15.3)', () => {
  it('counts pages and returns past-the-end pages to the last one', () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(41, 20)).toBe(3);
    expect(clampPage(9, 41, 20)).toBe(3);
    expect(clampPage(0, 41, 20)).toBe(1);
    expect(slicePage([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
  });

  it('shows every page up to 7, else first/last with gaps', () => {
    expect(pageItems(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageItems(1, 20)).toEqual([1, 2, 3, 4, 5, 'gap', 20]);
    expect(pageItems(10, 20)).toEqual([1, 'gap', 9, 10, 11, 'gap', 20]);
    expect(pageItems(20, 20)).toEqual([1, 'gap', 16, 17, 18, 19, 20]);
  });

  it('reads page and size from the route, sizes 20 / 50 / 100 only', () => {
    expect(readPaging({ page: '3', size: '50' })).toEqual({ page: 3, size: 50 });
    expect(readPaging({ page: '-1', size: '7' })).toEqual({ page: 1, size: 20 });
    expect(readPaging({})).toEqual({ page: 1, size: 20 });
  });

  it('keeps defaults out of the URL and resets the page on a filter change', () => {
    expect(nextQuery({ page: '3', q: 'a' }, { q: 'b' })).toEqual({ q: 'b' });
    expect(nextQuery({ page: '2' }, { size: 50 })).toEqual({ size: '50' });
    expect(nextQuery({ size: '50' }, { page: 4 })).toEqual({
      size: '50',
      page: '4',
    });
    expect(nextQuery({ q: 'x', page: '2' }, { q: undefined })).toEqual({});
  });

  it('searches every given field case-insensitively', () => {
    expect(matchesSearch('rev', 'Revenue by region')).toBe(true);
    expect(matchesSearch('x', 'a', ['b', 'X y'])).toBe(true);
    expect(matchesSearch('', null)).toBe(true);
    expect(matchesSearch('zz', 'a', null)).toBe(false);
  });

  it('maps the Kailo list density to 40 / 32 px rows', () => {
    expect(rowHeight(listDensityOf('compact'))).toBe(32);
    expect(rowHeight(listDensityOf('comfortable'))).toBe(40);
    expect(rowHeight(listDensityOf(undefined))).toBe(40);
  });
});

describe('read failures (20 §15.4)', () => {
  it('turns admin and 403 refusals into the no-permission state', () => {
    expect(
      classifyLoadError({
        graphQLErrors: [{ extensions: { code: 'KAILO_ADMIN_REQUIRED' } }],
      }),
    ).toBe('forbidden');
    expect(classifyLoadError({ networkError: { statusCode: 403 } })).toBe(
      'forbidden',
    );
  });

  it('names the reason category without internal codes', () => {
    expect(classifyLoadError({ networkError: new Error('Failed to fetch') })).toBe(
      'network',
    );
    expect(classifyLoadError({ networkError: { statusCode: 502 } })).toBe(
      'unavailable',
    );
    expect(classifyLoadError({ networkError: { statusCode: 504 } })).toBe(
      'timeout',
    );
    expect(
      classifyLoadError({
        graphQLErrors: [{ extensions: { code: 'RESOURCE_NOT_FOUND' } }],
      }),
    ).toBe('gone');
    expect(classifyLoadError(null)).toBe('unknown');
  });

  it('toasts only mutations; reads fail in place', () => {
    const op = (operation: string) => ({
      query: { definitions: [{ kind: 'OperationDefinition', operation }] },
    });
    expect(isReadOperation(op('query'))).toBe(true);
    expect(isReadOperation(op('mutation'))).toBe(false);
    expect(isReadOperation(undefined)).toBe(false);
  });
});

describe('DD-165 quota refusals follow the Kailo locale', () => {
  it('chooses the wording from the decision, in either locale', () => {
    const refusal = (decision: string) => ({
      extensions: { code: 'KAILO_USAGE_REFUSED', decision },
    });
    const key = usageRefusalKey(refusal('TENANT_QUOTA_EXHAUSTED'));
    expect(kailoText('zh-CN', key!)).toContain('数据建模');
    expect(kailoText('en', key!)).toContain('Data Modeling');
    expect(usageRefusalKey(refusal('QUOTA_NOT_CONFIGURED'))).toBe(
      'usage.notConfigured',
    );
    expect(usageRefusalKey(refusal('UNAVAILABLE'))).toBe('usage.unavailable');
    expect(usageRefusalKey({ extensions: { code: 'OTHER' } })).toBeNull();
  });

  it('names the product 数据建模 / Data Modeling', () => {
    expect(kailoText('zh-CN', 'componentName')).toBe('数据建模');
    expect(kailoText('en', 'componentName')).toBe('Data Modeling');
  });
});

describe('chart theme from Kailo tokens (20 §15.2)', () => {
  const tokens = {
    foreground: 'hsl(0, 0%, 96%)',
    muted: 'hsl(0, 0%, 66%)',
    border: 'hsl(0, 0%, 18%)',
    background: 'hsl(0, 0%, 6%)',
    font: 'Inter',
    series: ['a', 'b', 'c', 'd', 'e'].map((_, i) => `hsl(${i * 60}, 80%, 60%)`),
  };

  it('parses token triplets and derives series six to ten', () => {
    expect(hslOf('247.7 98.60% 72.0%')).toBe('hsl(247.7, 98.60%, 72.0%)');
    expect(hslOf('nonsense')).toBeNull();
    expect(shiftLightness('hsl(10, 50%, 60%)', -18)).toBe('hsl(10, 50%, 42%)');
    const palette = chartPalette(tokens, true);
    expect(palette).toHaveLength(10);
    expect(palette.slice(0, 5)).toEqual(tokens.series);
  });

  it('draws on a transparent canvas with token text, grid and type scale', () => {
    const config = kailoChartConfig({}, { tokens, typeScale: 15 / 14 });
    expect(config.background).toBe('transparent');
    expect((config.title as any).color).toBe(tokens.foreground);
    expect(config.axis?.gridColor).toBe(tokens.border);
    expect(config.axis?.labelColor).toBe(tokens.muted);
    expect(config.axis?.labelFontSize).toBeCloseTo(12.9, 1);
    expect(config.range?.category).toEqual(chartPalette(tokens, false));
    expect(config.font).toBe('Inter');
  });
});
