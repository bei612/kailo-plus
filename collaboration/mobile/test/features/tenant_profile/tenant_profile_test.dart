import 'dart:async';
import 'package:buzz/features/tenant_profile/tenant_profile_controller.dart';
import 'package:buzz/shared/platform/platform_api.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:buzz/features/tenant_profile/tenant_profile_page.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const profile = PlatformResponse(200, {
  'name': 'Before',
  'version': 3,
  'icon': '🎉',
  'updateActionKey': 'tenant.profile.update',
});
const receipt = PlatformResponse(200, {
  'actionKey': 'tenant.profile.update',
  'actionExecutionId': 'ae-1',
  'operationId': 'op-1',
  'gateState': 'ALLOWED',
  'dispatchState': 'DISPATCHED',
});
void main() {
  test(
    'requires confirmation and retries the same version and frozen request after result loss',
    () async {
      final sent = <Map<String, dynamic>>[];
      bool saved = false;
      final controller = TenantProfileController((method, path, {body}) async {
        if (method == PlatformMethod.get) {
          return saved
              ? const PlatformResponse(200, {
                  'name': 'After',
                  'version': 4,
                  'icon': '🎉',
                  'updateActionKey': 'tenant.profile.update',
                })
              : profile;
        }
        sent.add(body!);
        if (sent.length == 1) {
          throw Exception('lost');
        }
        saved = true;
        return receipt;
      });
      addTearDown(controller.dispose);
      await controller.refresh();
      controller.name = 'After';
      expect(controller.canSave, isFalse);
      controller.confirmed = true;
      expect(await controller.save(), isFalse);
      expect(controller.unknown, isTrue);
      controller.name = 'late accidental edit';
      expect(await controller.save(), isTrue);
      expect(sent, hasLength(2));
      expect(sent[0], sent[1]);
      expect(sent[0]['resourceVersion'], 3);
      expect(sent[0]['explicitConfirmation'], true);
      expect(sent[0]['tenantProfile'], {'name': 'After'});
      expect(controller.name, 'After');
      expect(controller.view!.version, 4);
    },
  );
  test(
    'member cannot edit; definite conflict requires refresh before another intent',
    () async {
      final member = TenantProfileController(
        (method, path, {body}) async =>
            const PlatformResponse(200, {'name': 'Before', 'version': 3}),
      );
      addTearDown(member.dispose);
      await member.refresh();
      member.name = 'After';
      member.confirmed = true;
      expect(member.canSave, isFalse);
      final controller = TenantProfileController(
        (method, path, {body}) async => method == PlatformMethod.get
            ? profile
            : const PlatformResponse(409, {
                'class': 'CONFLICT',
                'reason': 'TARGET_STATE_CONFLICT',
              }),
      );
      addTearDown(controller.dispose);
      await controller.refresh();
      controller.name = 'After';
      controller.confirmed = true;
      await controller.save();
      expect(controller.unknown, isFalse);
      expect(controller.needsRefresh, isTrue);
      controller.confirmed = true;
      expect(controller.canSave, isFalse);
      await controller.refresh();
      expect(controller.name, 'Before');
    },
  );
  test('retired identity ignores late profile reads and writes', () async {
    final late = Completer<PlatformResponse>();
    final controller = TenantProfileController(
      (method, path, {body}) => late.future,
    );
    final read = controller.refresh();
    controller.dispose();
    late.complete(profile);
    await read;
    expect(controller.view, isNull);
    final lateWrite = Completer<PlatformResponse>();
    final writing = TenantProfileController(
      (method, path, {body}) async =>
          method == PlatformMethod.get ? profile : lateWrite.future,
    );
    await writing.refresh();
    writing.name = 'After';
    writing.confirmed = true;
    final save = writing.save();
    writing.dispose();
    lateWrite.complete(receipt);
    expect(await save, isFalse);
    expect(writing.view, isNull);
  });
  testWidgets(
    'actual Mobile form requires confirmation before sending the displayed Tenant version',
    (tester) async {
      tester.view.physicalSize = const Size(800, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final sent = <Map<String, dynamic>>[];
      final controller = TenantProfileController((method, path, {body}) async {
        if (method == PlatformMethod.get) {
          return profile;
        }
        sent.add(body!);
        return const PlatformResponse(503, {});
      });
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            savedPrefsProvider.overrideWithValue(prefs),
            tenantProfileControllerProvider.overrideWithValue(controller),
          ],
          child: MaterialApp(
            theme: AppTheme.light(),
            home: const TenantProfilePage(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final name = find.byWidgetPredicate(
        (widget) =>
            widget is TextField &&
            widget.decoration?.labelText == 'Community name',
      );
      await tester.enterText(name, 'After');
      await tester.pump();
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull,
      );
      await tester.tap(find.byType(Checkbox));
      await tester.pump();
      await tester.tap(find.byType(FilledButton));
      await tester.pumpAndSettle();
      expect(sent, hasLength(1));
      expect(sent.single['resourceVersion'], 3);
      expect(sent.single['tenantProfile'], {'name': 'After'});
      expect(sent.single['explicitConfirmation'], true);
      expect(controller.unknown, isTrue);
      expect(tester.widget<TextField>(name).enabled, isFalse);
    },
  );
}
