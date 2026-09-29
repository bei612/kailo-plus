import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/contracts/contracts.dart';
import '../../shared/kailo/kailo_api.dart';
import '../../shared/kailo/kailo_config.dart';
import '../../shared/kailo/kailo_device.dart';
import '../../shared/kailo/kailo_link.dart';
import '../../shared/kailo/kailo_platform_text.dart';
import '../../shared/kailo/kailo_views.dart';
import '../../shared/relay/relay.dart';
import '../../shared/utils/string_utils.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import '../../shared/widgets/modal_presentation.dart';
import 'kailo_async_view.dart';

/// 本人登记的原生设备，可撤销（`DD-77`、`DD-79`）。撤销只移出那一把公钥：
/// 此人的其他设备与 Web 不受影响；Relay 随后拒绝那台设备。
class KailoDevicesPage extends ConsumerWidget {
  const KailoDevicesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final thisDevice = ref.watch(myPubkeyProvider)?.toLowerCase();
    return Scaffold(
      appBar: AppBar(
        title: Text(
          kailoText(KailoMessageKey.platformDevicesMyTitle, locale: locale),
        ),
      ),
      body: KailoAsyncView(
        value: ref.watch(kailoDevicesProvider),
        onRetry: () => ref.invalidate(kailoDevicesProvider),
        builder: (context, devices) => ListView(
          children: [
            AppListCard(
              label: kailoText(
                KailoMessageKey.platformDevicesRegistered,
                locale: locale,
              ),
              children: [
                for (final device in devices)
                  AppListRow(
                    key: ValueKey('kailo-device-${device.pubkey}'),
                    title: device.pubkey.toLowerCase() == thisDevice
                        ? '${shortPubkey(device.pubkey)} (${kailoText(KailoMessageKey.platformDevicesThisDevice, locale: locale)})'
                        : shortPubkey(device.pubkey),
                    subtitle: _deviceSubtitle(device, locale),
                    trailing: device.state == BuzzIdentityState.ACTIVE
                        ? TextButton(
                            key: ValueKey('kailo-revoke-${device.pubkey}'),
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
                              kailoText(
                                KailoMessageKey.platformDevicesRevoke,
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
  final state = kailoBuzzIdentityStateText(device.state, locale: locale);
  return kailoText(
    KailoMessageKey.platformDevicesRegisteredAt,
    locale: locale,
    variables: {
      'state': state,
      'time': kailoAbsoluteTime(device.createdAt, locale: locale),
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
        kailoText(KailoMessageKey.platformDevicesRevokeTitle, locale: locale),
      ),
      content: Text(
        kailoText(
          isThisDevice
              ? KailoMessageKey.platformDevicesRevokeThisConfirm
              : KailoMessageKey.platformDevicesRevokeOtherConfirm,
          locale: locale,
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(false),
          child: Text(
            kailoText(KailoMessageKey.platformCancel, locale: locale),
          ),
        ),
        FilledButton(
          onPressed: () => Navigator.of(ctx).pop(true),
          child: Text(
            kailoText(KailoMessageKey.platformDevicesRevoke, locale: locale),
          ),
        ),
      ],
    ),
  );
  if (confirmed != true) return;
  final config = ref.read(kailoConfigProvider);
  if (config == null) return;

  String message;
  try {
    final response = await revokeDeviceKey(
      ref.read(kailoSessionProvider),
      config,
      pubkey,
    );
    if (response.isSuccess) {
      final status = ClientKeyStatus.fromJson(
        response.body! as Map<String, dynamic>,
      );
      message = kailoText(
        KailoMessageKey.platformDevicesStateAfterRevoke,
        locale: locale,
        variables: {
          'state': kailoBuzzIdentityStateText(status.state, locale: locale),
        },
      );
      if (isThisDevice) {
        await ref.read(kailoLinkProvider.notifier).forgetRevokedDevice();
        return;
      }
    } else {
      message = kailoErrorText(KailoApiError(response), locale: locale);
    }
  } on KailoNotSignedIn {
    await ref.read(kailoLinkProvider.notifier).signOut();
    return;
  } on Object catch (error) {
    message = kailoErrorText(error, locale: locale);
  }
  ref.invalidate(kailoDevicesProvider);
  if (!context.mounted) return;
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
}
