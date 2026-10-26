import 'dart:convert';
import 'dart:ui' as ui;
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import 'tenant_profile_controller.dart';

class TenantProfilePage extends ConsumerWidget {
  const TenantProfilePage({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.watch(tenantProfileControllerProvider);
    return _TenantProfileForm(
      key: ObjectKey(controller),
      controller: controller,
    );
  }
}

class _TenantProfileForm extends HookWidget {
  const _TenantProfileForm({super.key, required this.controller});
  final TenantProfileController controller;
  @override
  Widget build(BuildContext context) {
    useListenable(controller);
    final name = useTextEditingController(text: controller.name);
    final emoji = useTextEditingController();
    final processing = useState(false);
    final locale = Localizations.localeOf(context).toLanguageTag();
    String text(PlatformMessageKey key) => platformText(key, locale: locale);
    useEffect(() {
      Future.microtask(() async {
        if (controller.view == null && !controller.unknown) {
          await controller.refresh();
        }
      });
      return null;
    }, [controller]);
    useEffect(() {
      name.text = controller.name;
      return null;
    }, [controller.view]);
    Future<void> chooseImage() async {
      if (controller.locked || processing.value) {
        return;
      }
      processing.value = true;
      try {
        final file = await ImagePicker().pickImage(
          source: ImageSource.gallery,
          maxWidth: 256,
          maxHeight: 256,
          requestFullMetadata: false,
        );
        if (file == null || !context.mounted) {
          return;
        }
        if (await file.length() > 20 * 1024 * 1024) {
          throw const FormatException('large image');
        }
        final codec = await ui.instantiateImageCodec(await file.readAsBytes());
        ui.Image? source, image;
        try {
          source = (await codec.getNextFrame()).image;
          final side = source.width < source.height
              ? source.width
              : source.height;
          final recorder = ui.PictureRecorder();
          final canvas = Canvas(recorder);
          canvas.drawImageRect(
            source,
            Rect.fromLTWH(
              (source.width - side) / 2,
              (source.height - side) / 2,
              side.toDouble(),
              side.toDouble(),
            ),
            const Rect.fromLTWH(0, 0, 256, 256),
            Paint()..filterQuality = FilterQuality.high,
          );
          final picture = recorder.endRecording();
          try {
            image = await picture.toImage(256, 256);
          } finally {
            picture.dispose();
          }
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          if (bytes == null) {
            throw const FormatException('image unavailable');
          }
          final icon =
              'data:image/png;base64,${base64Encode(bytes.buffer.asUint8List())}';
          if (icon.length > 96 * 1024) {
            throw const FormatException('large icon');
          }
          if (context.mounted && !controller.locked) {
            controller.icon = icon;
            controller.confirmed = false;
            controller.changed();
          }
        } finally {
          codec.dispose();
          source?.dispose();
          image?.dispose();
        }
      } catch (_) {
        if (context.mounted) {
          controller.failed = true;
          controller.changed();
        }
      } finally {
        if (context.mounted) {
          processing.value = false;
        }
      }
    }

    final locked = controller.locked || processing.value;
    final icon = controller.icon;
    return FrostedScaffold(
      useUtilitySurfaceTheme: true,
      appBar: FrostedAppBar(
        centerTitle: true,
        title: Text(text(PlatformMessageKey.tenantProfileTitle)),
      ),
      body: ListView(
        padding: EdgeInsets.fromLTRB(
          Grid.gutter,
          frostedAppBarHeight(context) + Grid.sm,
          Grid.gutter,
          Grid.lg,
        ),
        children: [
          if (controller.loading) const LinearProgressIndicator(),
          if (controller.view != null) ...[
            Center(
              child: Container(
                width: 80,
                height: 80,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainer,
                  borderRadius: BorderRadius.circular(20),
                ),
                clipBehavior: Clip.antiAlias,
                child: icon.startsWith('data:image/')
                    ? Image.memory(
                        base64Decode(icon.split(',').last),
                        fit: BoxFit.cover,
                      )
                    : Center(
                        child: Text(
                          icon.isEmpty ? '' : icon,
                          style: const TextStyle(fontSize: 40),
                        ),
                      ),
              ),
            ),
            const SizedBox(height: Grid.sm),
            if (controller.editable) ...[
              Wrap(
                spacing: Grid.xs,
                children: [
                  OutlinedButton(
                    onPressed: locked ? null : chooseImage,
                    child: Text(text(PlatformMessageKey.tenantProfileImage)),
                  ),
                  if (icon.isNotEmpty)
                    TextButton(
                      onPressed: locked
                          ? null
                          : () {
                              controller.icon = '';
                              controller.confirmed = false;
                              controller.changed();
                            },
                      child: Text(text(PlatformMessageKey.tenantProfileClear)),
                    ),
                ],
              ),
              TextField(
                controller: emoji,
                enabled: !locked,
                decoration: InputDecoration(
                  labelText: text(PlatformMessageKey.tenantProfileEmoji),
                ),
                onChanged: (value) {
                  controller.icon = value;
                  controller.confirmed = false;
                  controller.changed();
                },
              ),
            ],
            TextField(
              controller: name,
              enabled: controller.editable && !locked,
              decoration: InputDecoration(
                labelText: text(PlatformMessageKey.tenantProfileName),
              ),
              onChanged: (value) {
                controller.name = value;
                controller.confirmed = false;
                controller.changed();
              },
            ),
            const SizedBox(height: Grid.sm),
            if (controller.editable) ...[
              Text(text(PlatformMessageKey.tenantProfileLimits)),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: controller.confirmed,
                onChanged: locked || !controller.dirty
                    ? null
                    : (value) {
                        controller.confirmed = value ?? false;
                        controller.changed();
                      },
                title: Text(text(PlatformMessageKey.tenantProfileConfirm)),
              ),
              FilledButton(
                onPressed: !controller.canSave || processing.value
                    ? null
                    : () async {
                        await controller.save();
                      },
                child: Text(
                  text(
                    controller.unknown
                        ? PlatformMessageKey.tenantProfileRetry
                        : PlatformMessageKey.tenantProfileSave,
                  ),
                ),
              ),
            ] else
              Text(text(PlatformMessageKey.tenantProfileReadOnly)),
          ],
          if (controller.failed)
            Text(
              text(
                controller.unknown
                    ? PlatformMessageKey.platformFeedbackUnknown
                    : PlatformMessageKey.tenantProfileFailed,
              ),
            ),
          TextButton(
            onPressed: locked ? null : controller.refresh,
            child: Text(text(PlatformMessageKey.tenantProfileRefresh)),
          ),
        ],
      ),
    );
  }
}
