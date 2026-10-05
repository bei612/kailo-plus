import { ApiHistoryRepository, ApiType } from './apiHistoryRepository';
import { Knex } from 'knex';

describe('API history credential boundary', () => {
  const headers = {
    Authorization: 'Bearer synthetic-identity-token',
    Cookie: 'native_session=synthetic-session',
    'X-Provider-Secret': 'synthetic-provider-key',
    'Content-Type': 'application/json',
    accept: 'text/event-stream',
  };

  it('sanitizes the actual repository insert, including native stream callers', async () => {
    const returning = jest.fn();
    const insert = jest.fn((record) => {
      returning.mockResolvedValue([record]);
      return { returning };
    });
    const knex = jest.fn(() => ({ insert }));
    const repository = new ApiHistoryRepository(knex as unknown as Knex);
    const result = await repository.createOne({
      projectId: 1,
      apiType: ApiType.STREAM_ASK,
      headers,
      requestPayload: { question: 'native question' },
    });
    const expected = {
      'Content-Type': 'application/json',
      accept: 'text/event-stream',
    };
    expect(JSON.parse(insert.mock.calls[0][0].headers)).toEqual(expected);
    expect(result.headers).toEqual(expected);
    expect(result.requestPayload).toEqual({ question: 'native question' });
    expect(headers.Authorization).toBe('Bearer synthetic-identity-token');
  });

  it.each([headers, JSON.stringify(headers), '{invalid', null, []])(
    'does not expose raw stored headers: %p',
    async (storedHeaders) => {
      const where = jest.fn().mockResolvedValue([{ headers: storedHeaders }]);
      const knex = jest.fn(() => ({ where }));
      const repository = new ApiHistoryRepository(knex as unknown as Knex);
      const result = await repository.findOneBy({ projectId: 1 });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('synthetic-');
      expect(serialized).not.toContain('invalid');
      expect(result.headers).toEqual(
        storedHeaders === headers || storedHeaders === JSON.stringify(headers)
          ? { 'Content-Type': 'application/json', accept: 'text/event-stream' }
          : {},
      );
    },
  );
});
