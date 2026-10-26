import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PreparationStatus from './components/pages/home/preparation/PreparationStatus';
import { AskingTaskStatus } from './apollo/client/graphql/__types__';
import { kailoText } from './utils/kailoI18n';

let mockLocale = 'zh';
jest.mock('next/router', () => ({ useRouter: () => ({ locale: mockLocale }) }));
jest.mock('./hooks/useAskPrompt', () => ({
  getIsFinished: (status: string) =>
    ['FINISHED', 'FAILED', 'STOPPED'].includes(status),
}));

describe('original Asking stopped controls consume governed query evidence', () => {
  test.each([
    ['zh', '查询待核验', '核验并继续'],
    ['en', 'Query awaiting verification', 'Verify and continue'],
  ])(
    'unknown SQL never appears cancelled or permanently generating (%s)',
    (locale, pending, resume) => {
      mockLocale = locale;
      const props: any = {
        data: {},
        preparedTask: {
          status: AskingTaskStatus.STOPPED,
          error: { message: 'NATIVE_EXECUTION_UNKNOWN' },
        },
      };
      const html = renderToStaticMarkup(<PreparationStatus {...props} />);
      expect(html).toContain(pending);
      expect(html).toContain(resume);
      expect(html).not.toContain(kailoText(locale, 'home.cancelledByUser'));
      expect(html).not.toContain('ant-spin');
    },
  );
  test('the original ordinary user-stop presentation remains unchanged', () => {
    const props: any = {
      data: {},
      preparedTask: { status: AskingTaskStatus.STOPPED },
    };
    // DD-157: Kailo wording in the page locale (the last one set above).
    const html = renderToStaticMarkup(<PreparationStatus {...props} />);
    expect(html).toContain(kailoText(mockLocale, 'home.cancelledByUser'));
    expect(html).toContain(kailoText(mockLocale, 'home.rerun'));
  });
});
