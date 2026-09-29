import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'package:client_kit/shared/contracts/contracts.dart';
import '../../shared/platform/platform_api.dart';
import '../../shared/platform/platform_config.dart';
import '../../shared/platform/platform_device.dart';
import '../../shared/platform/platform_link.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/relay/relay.dart';
import '../../shared/utils/string_utils.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import '../../shared/widgets/modal_presentation.dart';
import 'platform_async_view.dart';

/// 本人登记的原生设备，可撤销（`DD-77`、`DD-79`）。撤销只移出那一把公钥：
/// 此人的其他设备与 Web 不受影响；Relay 随后拒绝那台设备。
class PlatformDevicesPage extends ConsumerWidget {
  const PlatformDevicesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final thisDevice = ref.watch(myPubkeyProvider)?.toLowerCase();
    return Scaffold(
      appBar: AppBar(
        title: Text(
          platformText(
            PlatformMessageKey.platformDevicesMyTitle,
            locale: locale,
          ),
        ),
      ),
      body: PlatformAsyncView(
        value: ref.watch(platformDevicesProvider),
        onRetry: () => ref.invalidate(platformDevicesProvider),
        builder: (context, devices) => ListView(
          children: [
            AppListCard(
              label: platformText(
                PlatformMessageKey.platformDevicesRegistered,
                locale: locale,
              ),
              children: [
                for (final device in devices)
                  AppListRow(
                    key: ValueKey('platform-device-${device.pubkey}'),
                    title: device.pubkey.toLowerCase() == thisDevice
                        ? '${shortPubkey(device.pubkey)} (${platformText(PlatformMessageKey.platformDevicesThisDevice, locale: locale)})'
                        : shortPubkey(device.pubkey),
                    subtitle: _deviceSubtitle(device, locale),
                    trailing: device.state == BuzzIdentityState.ACTIVE
                        ? TextButton(
                            key: ValueKey('platform-revoke-${device.pubkey}'),
                            onPressed: () => unawaited(
                              _revoke(
                                context,
                                ref,
                                device.pubkey,
                                isThisDevice:
                                    device.pubkey.toLowerCase() == thisDevice,
                              ),
                            ),
                            child: Text(
                              platformText(
                                PlatformMessageKey.platformDevicesRevoke,
                                locale: locale,
                              ),
                            ),
                          )
                        : null,
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

String _deviceSubtitle(ClientKeyView device, String locale) {
  final state = platformBuzzIdentityStateText(device.state, locale: locale);
  return platformText(
    PlatformMessageKey.platformDevicesRegisteredAt,
    locale: locale,
    variables: {
      'state': state,
      'time': platformAbsoluteTime(device.createdAt, locale: locale),
    },
  );
}

Future<void> _revoke(
  BuildContext context,
  WidgetRef ref,
  String pubkey, {
  required bool isThisDevice,
}) async {
  final locale = Localizations.localeOf(context).toLanguageTag();
  final confirmed = await showBuzzDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(
        platformText(
          PlatformMessageKey.platformDevicesRevokeTitle,
          locale: locale,
        ),
      ),
      content: Text(
        platformText(
          isThisDevice
              ? PlatformMessageKey.platformDevicesRevokeThisConfirm
              : PlatformMessageKey.platformDevicesRevokeOtherConfirm,
          locale: locale,
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(false),
          child: Text(
            platformText(PlatformMessageKey.platformCancel, locale: locale),
          ),
        ),
        FilledButton(
          onPressed: () => Navigator.of(ctx).pop(true),
          child: Text(
            platformText(
              PlatformMessageKey.platformDevicesRevoke,
              locale: locale,
            ),
          ),
        ),
      ],
    ),
  );
  if (confirmed != true) return;
  final config = ref.read(platformConfigProvider);
  if (config == null) return;

  String message;
  try {
    final response = await revokeDeviceKey(
      ref.read(nativeSessionProvider),
      config,
      pubkey,
    );
    if (response.isSuccess) {
      final status = ClientKeyStatus.fromJson(
        response.body! as Map<String, dynamic>,
      );
      message = platformText(
        PlatformMessageKey.platformDevicesStateAfterRevoke,
        locale: locale,
        variables: {
          'state': platformBuzzIdentityStateText(status.state, locale: locale),
        },
      );
      if (isThisDevice) {
        await ref.read(platformLinkProvider.notifier).forgetRevokedDevice();
        return;
      }
    } else {
      message = platformErrorText(PlatformApiError(response), locale: locale);
    }
  } on PlatformNotSignedIn {
    await ref.read(platformLinkProvider.notifier).signOut();
    return;
  } on Object catch (error) {
    message = platformErrorText(error, locale: locale);
  }
  ref.invalidate(platformDevicesProvider);
  if (!context.mounted) return;
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
}
