import 'package:flutter/material.dart';

import '../../shared/platform/platform_link.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:client_kit/shared/platform/reason_text.dart';
import '../../shared/theme/theme.dart';

String kailoPhaseText(KailoLinkPhase phase, {String? locale}) => kailoText(
  switch (phase) {
    KailoLinkPhase.unconfigured => KailoMessageKey.nativeStatusUnconfigured,
    KailoLinkPhase.signedOut => KailoMessageKey.nativeStatusSignedOut,
    KailoLinkPhase.signingIn => KailoMessageKey.nativeSignInWaiting,
    KailoLinkPhase.registering => KailoMessageKey.nativeDeviceRegistering,
    KailoLinkPhase.awaitingActivation =>
      KailoMessageKey.nativeStatusAwaitingActivation,
    KailoLinkPhase.fetchingCommunity => KailoMessageKey.nativeCommunityLoading,
    KailoLinkPhase.linked => KailoMessageKey.nativeStatusLinked,
    KailoLinkPhase.failed => KailoMessageKey.nativeStatusFailed,
    KailoLinkPhase.outcomeUnknown => KailoMessageKey.nativeStatusOutcomeUnknown,
  },
  locale: locale,
);

/// 需要让用户看到的结论；没有结论要报时为 null。
String? kailoOutcomeText(KailoLinkState state, {String? locale}) {
  switch (state.phase) {
    case KailoLinkPhase.failed:
      final error = state.error;
      if (error != null) {
        return kailoText(
          KailoMessageKey.platformReasonWithCode,
          locale: locale,
          variables: {
            'text': kailoReasonText(error.reason, locale: locale),
            'code': kailoReasonCode(error.reason),
          },
        );
      }
      return kailoPhaseText(state.phase, locale: locale);
    case KailoLinkPhase.outcomeUnknown:
      // 原始异常只作诊断证据，不向用户显示，更不把结果不明渲染为失败。
      return kailoPhaseText(state.phase, locale: locale);
    default:
      return null;
  }
}

class KailoOutcomeBanner extends StatelessWidget {
  const KailoOutcomeBanner({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      key: const ValueKey('kailo-outcome'),
      decoration: BoxDecoration(
        color: context.colors.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(Radii.md),
      ),
      child: Padding(
        padding: const EdgeInsets.all(Grid.twelve),
        child: Text(text, style: context.textTheme.bodyMedium),
      ),
    );
  }
}
