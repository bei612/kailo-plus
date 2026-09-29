import 'package:buzz/shared/platform/platform_config.dart';
import 'package:buzz/shared/theme/theme_provider.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

KailoConfig _config(String native, String issuer, String client) =>
    KailoConfig(nativeApiUrl: native, oidcIssuer: issuer, oidcClientId: client);

void main() {
  test('accepts http(s) origins and a client id', () {
    expect(
      _config(
        'https://k.test:8443',
        'https://idp.test/realms/k',
        'n',
      ).validate(),
      isNull,
    );
  });

  test('rejects anything that is not a plain http(s) address', () {
    for (final bad in [
      _config('ftp://k.test', 'https://idp.test', 'n'),
      _config('https://k.test?x=1', 'https://idp.test', 'n'),
      _config('https://k.test', 'https://idp.test#f', 'n'),
      _config('https://u:p@k.test', 'https://idp.test', 'n'),
      _config('not a url', 'https://idp.test', 'n'),
      _config('https://k.test', 'https://idp.test', '  '),
    ]) {
      expect(bad.validate(), isNotNull, reason: bad.toJson().toString());
    }
  });

  test('returns typed validation issues instead of display-language text', () {
    expect(
      _config('ftp://k.test', 'https://idp.test', 'n').validate(),
      KailoConfigIssue.nativeInvalidScheme,
    );
    expect(
      _config('https://k.test', 'https://idp.test#f', 'n').validate(),
      KailoConfigIssue.issuerQueryOrFragment,
    );
    expect(
      _config('https://k.test', 'https://idp.test', ' ').validate(),
      KailoConfigIssue.clientIdRequired,
    );
  });

  test('joins API paths without a double slash', () {
    final config = _config('https://k.test:8443/', 'https://idp.test/', 'n');
    expect(
      config.apiUri('/api/v1/session').toString(),
      'https://k.test:8443/api/v1/session',
    );
    expect(
      config.discoveryUri.toString(),
      'https://idp.test/.well-known/openid-configuration',
    );
  });

  test('persists only a valid configuration and has no default', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final container = ProviderContainer(
      overrides: [savedPrefsProvider.overrideWithValue(prefs)],
    );
    addTearDown(container.dispose);

    expect(container.read(kailoConfigProvider), isNull);
    await expectLater(
      container
          .read(kailoConfigProvider.notifier)
          .save(_config('ftp://k.test', 'https://idp.test', 'n')),
      throwsArgumentError,
    );
    expect(container.read(kailoConfigProvider), isNull);

    final good = _config(' https://k.test ', 'https://idp.test', ' n ');
    await container.read(kailoConfigProvider.notifier).save(good);
    expect(
      container.read(kailoConfigProvider),
      _config('https://k.test', 'https://idp.test', 'n'),
    );

    final reloaded = ProviderContainer(
      overrides: [savedPrefsProvider.overrideWithValue(prefs)],
    );
    addTearDown(reloaded.dispose);
    expect(reloaded.read(kailoConfigProvider)?.nativeApiUrl, 'https://k.test');
  });
}
