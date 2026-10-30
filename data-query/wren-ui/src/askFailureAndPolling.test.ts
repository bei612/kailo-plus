import { readFileSync } from 'fs';
import { join } from 'path';
import { RecommendedQuestionsTaskStatus as Status } from '@/apollo/client/graphql/__types__';
import { isRecommendationObservationDone } from '@/utils/recommendationObservation';
import { askErrorText } from '@/utils/askError';
import { kailoText } from '@/utils/kailoI18n';
import * as Errors from '@server/utils/error';

// data-query/fork/verify/ask-empty-sql.md
describe('thread recommendation observation stops on a settled task', () => {
  // The getThreadRecommendationQuestions shapes the production threads read
  // back on 2026-10-30: all of them were polled once a second without end.
  const settled = [
    // threads 2, 3, 7: no recommendation was ever dispatched
    {
      threadId: 7,
      queryId: null,
      sourceResponseId: null,
      status: Status.NOT_STARTED,
    },
    // threads 1, 4, 5, 6: finished before the source answer was recorded
    {
      threadId: 4,
      queryId: 'd89e6304-e295-424e-8ae3-c32eb4931dee',
      sourceResponseId: null,
      status: Status.FINISHED,
    },
    {
      threadId: 4,
      queryId: 'd89e6304-e295-424e-8ae3-c32eb4931dee',
      sourceResponseId: 3,
      status: Status.FAILED,
    },
  ];

  it.each(settled)('ends after one read of %o', (task) => {
    expect(isRecommendationObservationDone(task, task.threadId)).toBe(true);
  });

  it('keeps observing while the server can still change the task', () => {
    const generating = { threadId: 4, status: Status.GENERATING };
    expect(isRecommendationObservationDone(generating, 4)).toBe(false);
  });

  it('does not settle on a missing read or another thread', () => {
    expect(isRecommendationObservationDone(null, 4)).toBe(false);
    expect(isRecommendationObservationDone(undefined, 4)).toBe(false);
    expect(
      isRecommendationObservationDone(
        { threadId: 5, status: Status.FINISHED },
        4,
      ),
    ).toBe(false);
  });

  it('is the stop condition of the thread page observer', () => {
    const page = readFileSync(join(__dirname, 'pages/home/[id].tsx'), 'utf8');
    const observer = page.slice(
      page.indexOf('const observeRecommendations = () =>'),
      page.indexOf('useEffect(() => {\n    recommendationOwner.active = true;'),
    );
    expect(observer).toContain(
      'terminal = isRecommendationObservationDone(task, threadId);',
    );
    // Display adoption no longer decides whether reading continues.
    expect(observer).not.toMatch(/if \(!result\.error && acceptRecommendation/);
  });
});

describe('an answer without SQL is a named, explained failure', () => {
  const failure = {
    code: 'NO_SQL_GENERATED',
    message:
      'No SQL was generated: the model spent its whole output limit on hidden reasoning',
    shortMessage: 'No SQL was generated',
  };

  it('has its own server code and messages, not Internal server error', () => {
    const error = Errors.create(Errors.GeneralErrorCodes.NO_SQL_GENERATED);
    expect(error.extensions.code).toBe('NO_SQL_GENERATED');
    expect(error.extensions.shortMessage).toBe('No SQL was generated');
    expect(error.message).not.toBe('Internal server error');
  });

  it('is shown in the user locale', () => {
    const zh = askErrorText(failure, (key) => kailoText('zh-CN', key));
    expect(zh).toEqual({
      shortMessage: '模型没有生成 SQL',
      message: kailoText('zh-CN', 'home.noSqlGeneratedHint'),
    });
    const en = askErrorText(failure, (key) => kailoText('en', key));
    expect(en.shortMessage).toBe('No SQL was generated');
    expect(en.message).toContain('ask an administrator');
  });

  it('leaves every other failure as the server reported it', () => {
    const other = { code: 'NO_RELEVANT_SQL', message: 'm', shortMessage: 's' };
    expect(askErrorText(other, (key) => key)).toEqual({
      shortMessage: 's',
      message: 'm',
    });
    expect(
      askErrorText({ code: 'constructor', message: 'm' }, (key) => key),
    ).toEqual({ shortMessage: undefined, message: 'm' });
    expect(askErrorText(null, (key) => key)).toEqual({
      shortMessage: undefined,
      message: undefined,
    });
  });
});
