import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/platform/platform_api.dart';
import '../../shared/platform/platform_config.dart';
import '../../shared/platform/platform_link.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import '../../shared/theme/theme.dart';
import 'platform_status_text.dart';

/// 未登录时的首页：部署配置与企业账号登录（Kailo `DD-78`）。
///
/// 登录在系统浏览器里完成；这一页只显示进度与结论。结论不明时显示「不明」，
/// 不当作成功或失败。
class KailoSignInPage extends HookConsumerWidget {
  const KailoSignInPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final config = ref.watch(kailoConfigProvider);
    final link = ref.watch(kailoLinkProvider);
    final editing = useState(config == null);

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(Grid.gutter),
          children: [
            const SizedBox(height: Grid.lg),
            Text(
              kailoText(KailoMessageKey.platformTitle, locale: locale),
              style: context.textTheme.headlineMedium,
            ),
            const SizedBox(height: Grid.xxs),
            Text(
              kailoText(KailoMessageKey.nativeSignInExplain, locale: locale),
              style: context.textTheme.bodyMedium?.copyWith(
                color: context.colors.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: Grid.md),
            if (editing.value || config == null)
              KailoConfigForm(
                initial: config,
                onSaved: () => editing.value = false,
                onCancel: config == null ? null : () => editing.value = false,
              )
            else ...[
              _SignInControls(state: link),
              const SizedBox(height: Grid.sm),
              TextButton(
                key: const ValueKey('kailo-edit-config'),
                onPressed: link.busy ? null : () => editing.value = true,
                child: Text(
                  kailoText(
                    KailoMessageKey.nativeConfigServer,
                    locale: locale,
                    variables: {'host': Uri.parse(config.nativeApiUrl).host},
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SignInControls extends ConsumerWidget {
  const _SignInControls({required this.state});

  final KailoLinkState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final notifier = ref.read(kailoLinkProvider.notifier);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (state.busy) ...[
          Row(
            children: [
              if (!state.manualRecheck) ...[
                const SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                const SizedBox(width: Grid.twelve),
              ],
              Expanded(
                child: Text(kailoPhaseText(state.phase, locale: locale)),
              ),
            ],
          ),
          const SizedBox(height: Grid.xs),
          if (state.manualRecheck)
            FilledButton(
              key: const ValueKey('kailo-recheck-activation'),
              onPressed: () => unawaited(notifier.reconcile()),
              child: Text(
                kailoText(KailoMessageKey.nativeDeviceCheck, locale: locale),
              ),
            ),
          OutlinedButton(
            key: const ValueKey('kailo-cancel-sign-in'),
            onPressed: notifier.cancel,
            child: Text(
              kailoText(KailoMessageKey.platformCancel, locale: locale),
            ),
          ),
        ] else ...[
          if (kailoOutcomeText(state, locale: locale) case final outcome?) ...[
            KailoOutcomeBanner(text: outcome),
            const SizedBox(height: Grid.xs),
          ],
          FilledButton(
            key: const ValueKey('kailo-sign-in'),
            onPressed: () => unawaited(notifier.signIn()),
            child: Text(
              kailoText(KailoMessageKey.nativeSignInStart, locale: locale),
            ),
          ),
        ],
      ],
    );
  }
}

/// 部署配置表单。三项都来自部署方，不预填任何地址。
class KailoConfigForm extends HookConsumerWidget {
  const KailoConfigForm({
    super.key,
    required this.initial,
    required this.onSaved,
    this.onCancel,
  });

  final KailoConfig? initial;
  final VoidCallback onSaved;
  final VoidCallback? onCancel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final native = useTextEditingController(text: initial?.nativeApiUrl);
    final issuer = useTextEditingController(text: initial?.oidcIssuer);
    final client = useTextEditingController(text: initial?.oidcClientId);
    final problem = useState<KailoConfigIssue?>(null);

    Future<void> save() async {
      final config = KailoConfig(
        nativeApiUrl: native.text,
        oidcIssuer: issuer.text,
        oidcClientId: client.text,
      );
      final invalid = config.validate();
      if (invalid != null) {
        problem.value = invalid;
        return;
      }
      if (config != initial) {
        // 换了部署：旧部署签发的令牌不属于新的 IdP，不带过去
        await ref.read(kailoSessionProvider).discardCredentials();
      }
      await ref.read(kailoConfigProvider.notifier).save(config);
      onSaved();
    }

    InputDecoration field(String label) =>
        InputDecoration(labelText: label, border: const OutlineInputBorder());

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(kailoText(KailoMessageKey.nativeConfigExplain, locale: locale)),
        const SizedBox(height: Grid.sm),
        TextField(
          key: const ValueKey('kailo-config-native-url'),
          controller: native,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: field(
            kailoText(KailoMessageKey.nativeConfigNativeApiUrl, locale: locale),
          ),
        ),
        const SizedBox(height: Grid.xs),
        TextField(
          key: const ValueKey('kailo-config-issuer'),
          controller: issuer,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: field(
            kailoText(KailoMessageKey.nativeConfigOidcIssuer, locale: locale),
          ),
        ),
        const SizedBox(height: Grid.xs),
        TextField(
          key: const ValueKey('kailo-config-client-id'),
          controller: client,
          autocorrect: false,
          decoration: field(
            kailoText(KailoMessageKey.nativeConfigOidcClientId, locale: locale),
          ),
        ),
        if (problem.value case final issue?) ...[
          const SizedBox(height: Grid.xs),
          Text(
            _configIssueText(issue, locale),
            style: TextStyle(color: context.colors.error),
          ),
        ],
        const SizedBox(height: Grid.sm),
        FilledButton(
          key: const ValueKey('kailo-config-save'),
          onPressed: () => unawaited(save()),
          child: Text(
            kailoText(KailoMessageKey.nativeConfigSave, locale: locale),
          ),
        ),
        if (onCancel case final cancel?)
          TextButton(
            onPressed: cancel,
            child: Text(
              kailoText(KailoMessageKey.platformCancel, locale: locale),
            ),
          ),
      ],
    );
  }
}

String _configIssueText(KailoConfigIssue issue, String locale) {
  final (message, field) = switch (issue) {
    KailoConfigIssue.nativeInvalidUrl => (
      KailoMessageKey.nativeConfigInvalidUrl,
      KailoMessageKey.nativeConfigNativeApiUrl,
    ),
    KailoConfigIssue.issuerInvalidUrl => (
      KailoMessageKey.nativeConfigInvalidUrl,
      KailoMessageKey.nativeConfigOidcIssuer,
    ),
    KailoConfigIssue.nativeInvalidScheme => (
      KailoMessageKey.nativeConfigInvalidScheme,
      KailoMessageKey.nativeConfigNativeApiUrl,
    ),
    KailoConfigIssue.issuerInvalidScheme => (
      KailoMessageKey.nativeConfigInvalidScheme,
      KailoMessageKey.nativeConfigOidcIssuer,
    ),
    KailoConfigIssue.nativeQueryOrFragment => (
      KailoMessageKey.nativeConfigInvalidExtras,
      KailoMessageKey.nativeConfigNativeApiUrl,
    ),
    KailoConfigIssue.issuerQueryOrFragment => (
      KailoMessageKey.nativeConfigInvalidExtras,
      KailoMessageKey.nativeConfigOidcIssuer,
    ),
    KailoConfigIssue.nativeUserInfo => (
      KailoMessageKey.nativeConfigInvalidUserInfo,
      KailoMessageKey.nativeConfigNativeApiUrl,
    ),
    KailoConfigIssue.issuerUserInfo => (
      KailoMessageKey.nativeConfigInvalidUserInfo,
      KailoMessageKey.nativeConfigOidcIssuer,
    ),
    KailoConfigIssue.clientIdRequired => (
      KailoMessageKey.nativeConfigClientIdRequired,
      null,
    ),
  };
  return kailoText(
    message,
    locale: locale,
    variables: field == null
        ? null
        : {'field': kailoText(field, locale: locale)},
  );
}
