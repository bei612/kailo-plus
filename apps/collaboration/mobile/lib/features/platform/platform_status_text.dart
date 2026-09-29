import 'package:flutter/material.dart';

import '../../shared/platform/platform_link.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:client_kit/shared/platform/reason_text.dart';
import '../../shared/theme/theme.dart';

String platformPhaseText(
  PlatformLinkPhase phase, {
  String? locale,
}) => platformText(switch (phase) {
  PlatformLinkPhase.unconfigured => PlatformMessageKey.nativeStatusUnconfigured,
  PlatformLinkPhase.signedOut => PlatformMessageKey.nativeStatusSignedOut,
  PlatformLinkPhase.signingIn => PlatformMessageKey.nativeSignInWaiting,
  PlatformLinkPhase.registering => PlatformMessageKey.nativeDeviceRegistering,
  PlatformLinkPhase.awaitingActivation =>
    PlatformMessageKey.nativeStatusAwaitingActivation,
  PlatformLinkPhase.fetchingCommunity =>
    PlatformMessageKey.nativeCommunityLoading,
  PlatformLinkPhase.linked => PlatformMessageKey.nativeStatusLinked,
  PlatformLinkPhase.failed => PlatformMessageKey.nativeStatusFailed,
  PlatformLinkPhase.outcomeUnknown =>
    PlatformMessageKey.nativeStatusOutcomeUnknown,
}, locale: locale);

/// 需要让用户看到的结论；没有结论要报时为 null。
String? platformOutcomeText(PlatformLinkState state, {String? locale}) {
  switch (state.phase) {
    case PlatformLinkPhase.failed:
      final error = state.error;
      if (error != null) {
        return platformText(
          PlatformMessageKey.platformReasonWithCode,
          locale: locale,
          variables: {
            'text': platformReasonText(error.reason, locale: locale),
            'code': platformReasonCode(error.reason),
          },
        );
      }
      return platformPhaseText(state.phase, locale: locale);
    case PlatformLinkPhase.outcomeUnknown:
      // 原始异常只作诊断证据，不向用户显示，更不把结果不明渲染为失败。
      return platformPhaseText(state.phase, locale: locale);
    default:
      return null;
  }
}

class PlatformOutcomeBanner extends StatelessWidget {
  const PlatformOutcomeBanner({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      key: const ValueKey('platform-outcome'),
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
