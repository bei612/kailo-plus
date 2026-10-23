import handler from './pages/api/kailo/directory-access';
import {
  encodeKailoUser,
  KAILO_SERVICE_HEADER,
  KAILO_USER_HEADER,
} from './utils/kailoUser';

// DD-133(4): the Node consumer behind the middleware's entry admission.
jest.mock('./common', () => ({ components: { kailoMemberDirectory: null } }));
const mockComponents: { kailoMemberDirectory: any } =
  jest.requireMock('./common').components;

const user = {
  key: 'a'.repeat(64),
  name: 'Member',
  username: null,
  email: null,
  picture: null,
  locale: null,
  admin: false,
};

function call(headers: Record<string, string>, method = 'GET') {
  const res: any = {
    statusCode: 0,
    body: undefined,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return handler({ method, headers } as any, res).then(() => res);
}

describe('GET /api/kailo/directory-access', () => {
  test('answers only the verified user its own entry, never cached', async () => {
    mockComponents.kailoMemberDirectory = {
      access: jest.fn(async (key: string) => ({
        delivered: true,
        member: key === user.key,
        admin: true,
      })),
    };
    const res = await call({ [KAILO_USER_HEADER]: encodeKailoUser(user) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      userKey: user.key,
      delivered: true,
      member: true,
      admin: true,
    });
  });

  test('no verified user, the native service, other methods, no directory or a failing store are refused', async () => {
    mockComponents.kailoMemberDirectory = {
      access: jest.fn(async () => {
        throw new Error('db down');
      }),
    };
    expect((await call({})).statusCode).toBe(401);
    expect(
      (
        await call({
          [KAILO_USER_HEADER]: encodeKailoUser(user),
          [KAILO_SERVICE_HEADER]: '1',
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await call({ [KAILO_USER_HEADER]: encodeKailoUser(user) }, 'POST'))
        .statusCode,
    ).toBe(405);
    expect(
      (await call({ [KAILO_USER_HEADER]: encodeKailoUser(user) })).statusCode,
    ).toBe(503);
    mockComponents.kailoMemberDirectory = null;
    expect(
      (await call({ [KAILO_USER_HEADER]: encodeKailoUser(user) })).statusCode,
    ).toBe(503);
  });
});
