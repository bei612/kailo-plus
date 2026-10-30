import {
  DataSourceSelectionError,
  parseDataSourceId,
  requestDataSourceId,
  runInDataSource,
  selectedDataSourceId,
} from './apollo/server/utils/dataSourceScope';
import { ProjectRepository } from './apollo/server/repositories/projectRepository';
import {
  ConnectionCredentials,
  hasLocalCredentials,
  heldByKailo,
  KAILO_SECRET_FIELD,
  KAILO_SECRET_FIELDS,
  splitCredentials,
} from './apollo/server/services/connectionCredentials';
import {
  ComponentSecretRefused,
  ComponentSecretStore,
  ComponentSecretUnavailable,
  KailoComponentSecrets,
  validSecretValue,
} from './apollo/server/services/kailoComponentSecrets';
import {
  encryptConnectionInfo,
  toIbisConnectionInfo,
} from './apollo/server/dataSource';
import { DataSourceName } from './apollo/server/types';
import { scrubCredentials } from './apollo/server/resolvers/dataSourceResolver';
import { validDisplayName } from './apollo/server/resolvers/projectResolver';

// DD-169: data source management — request scoping, credential custody and
// the client of Core's component secret custody (`07` §4.8.11). No value used
// here is a real credential; assertions check that values never leak.

const PASSWORD = 'pw-fixture-not-a-secret';

describe('data source selection (DD-169(2)①)', () => {
  it('parses only positive integer ids and refuses malformed or conflicting ones', () => {
    expect(parseDataSourceId(undefined)).toBeNull();
    expect(parseDataSourceId('')).toBeNull();
    expect(parseDataSourceId('12')).toBe(12);
    for (const bad of ['0', '-1', '1.5', 'abc', '01', ['1', '2']])
      expect(() => parseDataSourceId(bad)).toThrow(DataSourceSelectionError);
    expect(
      requestDataSourceId({
        headers: { 'x-kailo-data-source': '3' },
        query: {},
      }),
    ).toBe(3);
    expect(
      requestDataSourceId({
        headers: {},
        query: { kailo_data_source: '4' },
      }),
    ).toBe(4);
    expect(() =>
      requestDataSourceId({
        headers: { 'x-kailo-data-source': '3' },
        query: { kailo_data_source: '4' },
      }),
    ).toThrow(DataSourceSelectionError);
  });

  it('carries the selection through the async chain of one request only', async () => {
    expect(selectedDataSourceId()).toBeNull();
    const seen = await runInDataSource(7, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return selectedDataSourceId();
    });
    expect(seen).toBe(7);
    expect(selectedDataSourceId()).toBeNull();
  });

  const repository = (rows: Array<{ id: number }>, bound?: number) => {
    const repo = new ProjectRepository(
      {} as any,
      bound ? async () => bound : undefined,
    );
    repo.findOneBy = jest.fn(
      async ({ id }: any) => rows.find((row) => row.id === id) || null,
    ) as any;
    repo.findAll = jest.fn(async () => rows.slice(0, 1)) as any;
    return repo;
  };

  it('uses the selected project, the first one without selection, and never another one', async () => {
    const repo = repository([{ id: 1 }, { id: 2 }]);
    expect((await repo.getCurrentProject()).id).toBe(1);
    expect((await runInDataSource(2, () => repo.getCurrentProject())).id).toBe(
      2,
    );
    await expect(
      runInDataSource(9, () => repo.getCurrentProject()),
    ).rejects.toThrow(DataSourceSelectionError);
  });

  it('keeps a GOVERNED instance on the binding project (DD-169(2)⑥)', async () => {
    const repo = repository([{ id: 1 }, { id: 2 }], 1);
    expect((await repo.getCurrentProject()).id).toBe(1);
    expect((await runInDataSource(1, () => repo.getCurrentProject())).id).toBe(
      1,
    );
    await expect(
      runInDataSource(2, () => repo.getCurrentProject()),
    ).rejects.toThrow(DataSourceSelectionError);
  });
});

class MemorySecrets implements ComponentSecretStore {
  values = new Map<string, Record<string, string>>();
  writes: any[] = [];
  retired: string[] = [];
  fail = false;
  async write(actor, value) {
    if (this.fail) throw new ComponentSecretUnavailable('write');
    const secretId = `00000000-0000-4000-8000-00000000000${this.values.size + 1}`;
    this.writes.push({ actor, value });
    this.values.set(secretId, { ...value });
    return { secretId, version: 1 };
  }
  async read(secretId) {
    const value = this.values.get(secretId);
    if (!value) throw new ComponentSecretRefused('read', 404);
    return { ...value };
  }
  async retire(_actor, secretId) {
    this.retired.push(secretId);
    this.values.delete(secretId);
  }
}

const actor = { issuer: 'https://idp.example', subject: 'admin-1' };
const postgres = {
  host: 'db.example',
  port: 5432,
  database: 'shop',
  user: 'reader',
  password: PASSWORD,
  ssl: false,
};

describe('connection credentials (DD-169(5))', () => {
  it('splits the credential fields of the type and refuses non-string credentials', () => {
    const { general, credentials } = splitCredentials(DataSourceName.POSTGRES, {
      ...postgres,
      [KAILO_SECRET_FIELD]: 'ignored',
    });
    expect(credentials).toEqual({ password: PASSWORD });
    expect(general).not.toHaveProperty('password');
    expect(general).not.toHaveProperty(KAILO_SECRET_FIELD);
    expect(() =>
      splitCredentials(DataSourceName.POSTGRES, { password: 42 }),
    ).toThrow('INVALID_CONNECTION_CREDENTIAL');
  });

  it('stores only a reference with custody and rebuilds the native shape in memory', async () => {
    const secrets = new MemorySecrets();
    const credentials = new ConnectionCredentials(secrets);
    const { stored, secretId } = await credentials.store(
      DataSourceName.POSTGRES,
      postgres,
      actor,
    );
    expect(secretId).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain(PASSWORD);
    expect(stored[KAILO_SECRET_FIELDS]).toEqual(['password']);
    expect(heldByKailo(stored)).toBe(true);
    expect(hasLocalCredentials(DataSourceName.POSTGRES, stored)).toBe(false);
    expect(secrets.writes[0]).toEqual({
      actor,
      value: { password: PASSWORD },
    });

    const resolved = await credentials.resolve(DataSourceName.POSTGRES, stored);
    expect(resolved).not.toHaveProperty(KAILO_SECRET_FIELD);
    expect(resolved.password).not.toBe(PASSWORD); // native ciphertext
    const ibis = toIbisConnectionInfo(DataSourceName.POSTGRES, resolved);
    expect(ibis.connectionUrl).toContain(encodeURIComponent(PASSWORD));

    expect(
      (await credentials.plaintext(DataSourceName.POSTGRES, stored)).password,
    ).toBe(PASSWORD);
    await credentials.retire(stored, actor);
    expect(secrets.retired).toEqual([secretId]);
  });

  it('fails closed: nothing is stored when custody is unavailable or no actor is known', async () => {
    const secrets = new MemorySecrets();
    const credentials = new ConnectionCredentials(secrets);
    secrets.fail = true;
    await expect(
      credentials.store(DataSourceName.POSTGRES, postgres, actor),
    ).rejects.toBeInstanceOf(ComponentSecretUnavailable);
    secrets.fail = false;
    await expect(
      credentials.store(DataSourceName.POSTGRES, postgres, null),
    ).rejects.toThrow('KAILO_ACTOR_REQUIRED');
    expect(secrets.values.size).toBe(0);
  });

  it('keeps the original encrypted storage without custody and migrates it later', async () => {
    const local = new ConnectionCredentials(null);
    const { stored } = await local.store(
      DataSourceName.POSTGRES,
      postgres,
      null,
    );
    expect(stored.password).not.toBe(PASSWORD);
    expect(hasLocalCredentials(DataSourceName.POSTGRES, stored)).toBe(true);
    // the migration path: plaintext of the native row, then custody
    const custody = new ConnectionCredentials(new MemorySecrets());
    const plain = await custody.plaintext(DataSourceName.POSTGRES, stored);
    expect(plain.password).toBe(PASSWORD);
    const moved = await custody.store(DataSourceName.POSTGRES, plain, actor);
    expect(heldByKailo(moved.stored)).toBe(true);
    expect(JSON.stringify(moved.stored)).not.toContain(PASSWORD);
  });

  it('resolving a reference without custody is a dependency failure', async () => {
    await expect(
      new ConnectionCredentials(null).resolve(DataSourceName.POSTGRES, {
        host: 'db.example',
        [KAILO_SECRET_FIELD]: '00000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toBeInstanceOf(ComponentSecretUnavailable);
    // the native shape for a plain connection is unchanged
    const native = encryptConnectionInfo(
      DataSourceName.POSTGRES,
      postgres as any,
    );
    expect(
      await new ConnectionCredentials(null).resolve(
        DataSourceName.POSTGRES,
        native,
      ),
    ).toEqual(native);
  });
});

describe('Core component secret custody client (`07` §4.8.11)', () => {
  const config = {
    bindingId: '11111111-1111-4111-8111-111111111111',
    clientId: 'wren-directory',
    clientSecretFile: '/nonexistent/secret',
    tokenUrl: 'https://idp.example/token',
    coreUrl: 'http://core:8081',
  };

  const client = (
    handler: (url: string, init: any) => { status: number; body?: any },
    now = () => 1_000_000,
  ) => {
    const calls: Array<{ url: string; init: any }> = [];
    const doFetch = jest.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      const { status, body } = handler(url, init);
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    });
    const secrets = new KailoComponentSecrets(config, doFetch as any, now);
    // The token request reads a client secret file; replace it for the test.
    (secrets as any).accessToken = async () => 'service-token';
    return { secrets, calls };
  };

  it('writes with the actor and purpose and returns only the reference', async () => {
    const { secrets, calls } = client(() => ({
      status: 201,
      body: {
        secretId: '22222222-2222-4222-8222-222222222222',
        version: 1,
        createdAt: '2026-10-30T00:00:00Z',
      },
    }));
    expect(await secrets.write(actor, { password: PASSWORD })).toEqual({
      secretId: '22222222-2222-4222-8222-222222222222',
      version: 1,
    });
    expect(calls[0].url).toBe(
      `${config.coreUrl}/service/v1/component-secrets/bindings/${config.bindingId}/secrets`,
    );
    expect(calls[0].init.headers.authorization).toBe('Bearer service-token');
    expect(JSON.parse(calls[0].init.body)).toEqual({
      purpose: 'DATA_SOURCE_CONNECTION',
      actor,
      value: { password: PASSWORD },
    });
  });

  it('caches reads for five minutes at most and drops them on retirement', async () => {
    let clock = 1_000_000;
    const id = '33333333-3333-4333-8333-333333333333';
    const { secrets, calls } = client(
      (url) =>
        url.endsWith('/retire')
          ? { status: 200, body: { secretId: id, state: 'RETIRED' } }
          : {
              status: 200,
              body: { secretId: id, version: 1, value: { password: PASSWORD } },
            },
      () => clock,
    );
    expect(await secrets.read(id)).toEqual({ password: PASSWORD });
    expect(await secrets.read(id)).toEqual({ password: PASSWORD });
    expect(calls).toHaveLength(1);
    clock += 5 * 60 * 1000 + 1;
    await secrets.read(id);
    expect(calls).toHaveLength(2);
    await secrets.retire(actor, id);
    await secrets.read(id);
    expect(calls.map((call) => call.url.split('/').pop())).toEqual([
      'read',
      'read',
      'retire',
      'read',
    ]);
  });

  it('maps refusals and outages without echoing the value', async () => {
    const refused = client(() => ({ status: 403 })).secrets;
    await expect(
      refused.write(actor, { password: PASSWORD }),
    ).rejects.toBeInstanceOf(ComponentSecretRefused);
    const down = client(() => ({ status: 503 })).secrets;
    const error = await down
      .write(actor, { password: PASSWORD })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(ComponentSecretUnavailable);
    expect(String(error.message)).not.toContain(PASSWORD);
    expect(validSecretValue({ password: 'x'.repeat(70 * 1024) })).toBe(false);
    expect(validSecretValue({ 'bad key': 'x' })).toBe(false);
    expect(validSecretValue({})).toBe(false);
  });
});

describe('data source management helpers (DD-169(6))', () => {
  it('scrubs every typed credential from a test error', () => {
    const message = `connection to db failed: password ${PASSWORD} rejected; url=postgres://u:${encodeURIComponent(PASSWORD)}@h`;
    const scrubbed = scrubCredentials(message, [PASSWORD]);
    expect(scrubbed).not.toContain(PASSWORD);
    expect(scrubbed).not.toContain(encodeURIComponent(PASSWORD));
  });

  it('accepts display names of 1–60 characters without control characters', () => {
    expect(validDisplayName('销售库')).toBe(true);
    expect(validDisplayName(' ')).toBe(false);
    expect(validDisplayName('a'.repeat(61))).toBe(false);
    expect(validDisplayName('a\u0007b')).toBe(false);
    expect(validDisplayName(undefined)).toBe(false);
  });
});
