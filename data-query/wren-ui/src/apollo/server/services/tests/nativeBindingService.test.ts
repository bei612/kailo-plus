import { governedConnectionInfo } from '../nativeBindingService';
import { NativeQueryRefusal } from '../nativeQueryAdmission';

// The KV v2 data map Core's governed application_binding.create writes for the
// release's `connection` secret (application_binding_secret.rs write_once:
// one field `value` holding the submitted string).
describe('governedConnectionInfo', () => {
  const connection = {
    host: 'reader.fixture.invalid',
    port: '5432',
    database: 'fixture',
    user: 'fixture_reader',
    password: 'fixture-only-password',
    ssl: false,
  };

  test('parses the governed string field into the original connectionInfo', () => {
    expect(
      governedConnectionInfo({ value: JSON.stringify(connection) }),
    ).toEqual(connection);
  });

  test.each([
    ['a missing data map', undefined],
    ['the ungoverned connectionInfo map', { connectionInfo: connection }],
    [
      'an extra field beside value',
      { value: JSON.stringify(connection), connectionInfo: connection },
    ],
    ['a non-string value', { value: connection }],
    ['non-JSON text', { value: 'host=reader password=fixture-only-password' }],
    ['a JSON array', { value: JSON.stringify([connection]) }],
    ['a JSON scalar', { value: JSON.stringify('fixture-only-password') }],
    ['an empty object', { value: '{}' }],
  ])('refuses %s without echoing secret bytes', (_label, data) => {
    let refusal: unknown;
    try {
      governedConnectionInfo(data);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(NativeQueryRefusal);
    expect(refusal).toMatchObject({
      status: 403,
      code: 'BINDING_SCOPE_DENIED',
    });
    expect(String((refusal as Error).message)).not.toContain('fixture-only');
  });
});
