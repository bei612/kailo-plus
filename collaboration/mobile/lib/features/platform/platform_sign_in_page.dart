import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/platform/platform_api.dart';
import '../../shared/platform/platform_config.dart';
import '../../shared/platform/platform_display_name.dart';
import '../../shared/platform/platform_link.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import '../../shared/theme/theme.dart';
import 'platform_status_text.dart';

/// 未登录时的首页：部署配置与企业账号登录（`DD-78`、`DD-111`）。
///
/// 登录在系统浏览器里完成；这一页只显示进度与结论。结论不明时显示「不明」，
/// 不当作成功或失败。
class PlatformSignInPage extends HookConsumerWidget {
  const PlatformSignInPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final config = ref.watch(platformConfigProvider);
    final link = ref.watch(platformLinkProvider);
    // 部署显示名（DD-111）：只有该服务器此前登录后读到过才有，否则是中性标题
    final displayName = ref.watch(platformDisplayNameProvider);
    final editing = useState(config == null);

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(Grid.gutter),
          children: [
            const SizedBox(height: Grid.lg),
            Text(
              displayName == null
                  ? platformText(
                      PlatformMessageKey.platformTitle,
                      locale: locale,
                    )
                  : platformText(
                      PlatformMessageKey.nativeSignInTitleNamed,
                      locale: locale,
                      variables: {'name': displayName},
                    ),
              style: context.textTheme.headlineMedium,
            ),
            const SizedBox(height: Grid.xxs),
            Text(
              platformText(
                PlatformMessageKey.nativeSignInExplain,
                locale: locale,
              ),
              style: context.textTheme.bodyMedium?.copyWith(
                color: context.colors.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: Grid.md),
            if (editing.value || config == null)
              PlatformConfigForm(
                initial: config,
                onSaved: () => editing.value = false,
                onCancel: config == null ? null : () => editing.value = false,
              )
            else ...[
              _SignInControls(state: link),
              const SizedBox(height: Grid.sm),
              TextButton(
                key: const ValueKey('platform-edit-config'),
                onPressed: link.busy ? null : () => editing.value = true,
                child: Text(
                  platformText(
                    PlatformMessageKey.nativeConfigServer,
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

  final PlatformLinkState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final notifier = ref.read(platformLinkProvider.notifier);
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
                child: Text(platformPhaseText(state.phase, locale: locale)),
              ),
            ],
          ),
          const SizedBox(height: Grid.xs),
          if (state.manualRecheck)
            FilledButton(
              key: const ValueKey('platform-recheck-activation'),
              onPressed: () => unawaited(notifier.reconcile()),
              child: Text(
                platformText(
                  PlatformMessageKey.nativeDeviceCheck,
                  locale: locale,
                ),
              ),
            ),
          OutlinedButton(
            key: const ValueKey('platform-cancel-sign-in'),
            onPressed: notifier.cancel,
            child: Text(
              platformText(PlatformMessageKey.platformCancel, locale: locale),
            ),
          ),
        ] else ...[
          if (platformOutcomeText(state, locale: locale)
              case final outcome?) ...[
            PlatformOutcomeBanner(text: outcome),
            const SizedBox(height: Grid.xs),
          ],
          FilledButton(
            key: const ValueKey('platform-sign-in'),
            onPressed: () => unawaited(notifier.signIn()),
            child: Text(
              platformText(
                PlatformMessageKey.nativeSignInStart,
                locale: locale,
              ),
            ),
          ),
        ],
      ],
    );
  }
}

/// 部署配置表单。三项都来自部署方，不预填任何地址。
class PlatformConfigForm extends HookConsumerWidget {
  const PlatformConfigForm({
    super.key,
    required this.initial,
    required this.onSaved,
    this.onCancel,
  });

  final PlatformConfig? initial;
  final VoidCallback onSaved;
  final VoidCallback? onCancel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final native = useTextEditingController(text: initial?.nativeApiUrl);
    final issuer = useTextEditingController(text: initial?.oidcIssuer);
    final client = useTextEditingController(text: initial?.oidcClientId);
    final problem = useState<PlatformConfigIssue?>(null);

    Future<void> save() async {
      final config = PlatformConfig(
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
        await ref.read(nativeSessionProvider).discardCredentials();
      }
      await ref.read(platformConfigProvider.notifier).save(config);
      onSaved();
    }

    InputDecoration field(String label) =>
        InputDecoration(labelText: label, border: const OutlineInputBorder());

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          platformText(PlatformMessageKey.nativeConfigExplain, locale: locale),
        ),
        const SizedBox(height: Grid.sm),
        TextField(
          key: const ValueKey('platform-config-native-url'),
          controller: native,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: field(
            platformText(
              PlatformMessageKey.nativeConfigNativeApiUrl,
              locale: locale,
            ),
          ),
        ),
        const SizedBox(height: Grid.xs),
        TextField(
          key: const ValueKey('platform-config-issuer'),
          controller: issuer,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: field(
            platformText(
              PlatformMessageKey.nativeConfigOidcIssuer,
              locale: locale,
            ),
          ),
        ),
        const SizedBox(height: Grid.xs),
        TextField(
          key: const ValueKey('platform-config-client-id'),
          controller: client,
          autocorrect: false,
          decoration: field(
            platformText(
              PlatformMessageKey.nativeConfigOidcClientId,
              locale: locale,
            ),
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
          key: const ValueKey('platform-config-save'),
          onPressed: () => unawaited(save()),
          child: Text(
            platformText(PlatformMessageKey.nativeConfigSave, locale: locale),
          ),
        ),
        if (onCancel case final cancel?)
          TextButton(
            onPressed: cancel,
            child: Text(
              platformText(PlatformMessageKey.platformCancel, locale: locale),
            ),
          ),
      ],
    );
  }
}

String _configIssueText(PlatformConfigIssue issue, String locale) {
  final (message, field) = switch (issue) {
    PlatformConfigIssue.nativeInvalidUrl => (
      PlatformMessageKey.nativeConfigInvalidUrl,
      PlatformMessageKey.nativeConfigNativeApiUrl,
    ),
    PlatformConfigIssue.issuerInvalidUrl => (
      PlatformMessageKey.nativeConfigInvalidUrl,
      PlatformMessageKey.nativeConfigOidcIssuer,
    ),
    PlatformConfigIssue.nativeInvalidScheme => (
      PlatformMessageKey.nativeConfigInvalidScheme,
      PlatformMessageKey.nativeConfigNativeApiUrl,
    ),
    PlatformConfigIssue.issuerInvalidScheme => (
      PlatformMessageKey.nativeConfigInvalidScheme,
      PlatformMessageKey.nativeConfigOidcIssuer,
    ),
    PlatformConfigIssue.nativeQueryOrFragment => (
      PlatformMessageKey.nativeConfigInvalidExtras,
      PlatformMessageKey.nativeConfigNativeApiUrl,
    ),
    PlatformConfigIssue.issuerQueryOrFragment => (
      PlatformMessageKey.nativeConfigInvalidExtras,
      PlatformMessageKey.nativeConfigOidcIssuer,
    ),
    PlatformConfigIssue.nativeUserInfo => (
      PlatformMessageKey.nativeConfigInvalidUserInfo,
      PlatformMessageKey.nativeConfigNativeApiUrl,
    ),
    PlatformConfigIssue.issuerUserInfo => (
      PlatformMessageKey.nativeConfigInvalidUserInfo,
      PlatformMessageKey.nativeConfigOidcIssuer,
    ),
    PlatformConfigIssue.clientIdRequired => (
      PlatformMessageKey.nativeConfigClientIdRequired,
      null,
    ),
  };
  return platformText(
    message,
    locale: locale,
    variables: field == null
        ? null
        : {'field': platformText(field, locale: locale)},
  );
}
