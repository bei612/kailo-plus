import { chartRowsReady } from '@/utils/chartRows';

describe('chartRowsReady (acceptance batch 5)', () => {
  const rows = { columns: [{ name: 'store_type' }], data: [['旗舰店']] };

  it('renders completed preview rows even without a platform receipt', () => {
    expect(chartRowsReady({ completed: true, data: rows })).toBe(true);
  });

  it('does not render before completion or without rows', () => {
    expect(chartRowsReady({ completed: false, data: rows })).toBe(false);
    expect(chartRowsReady({ completed: true, data: undefined })).toBe(false);
    expect(chartRowsReady({ completed: true, data: { columns: [] } })).toBe(
      false,
    );
  });
});
