import 'dart:async';

import 'package:buzz/features/settings/theme_picker_page.dart';
import 'package:buzz/shared/community/community.dart';
import 'package:buzz/shared/community/community_icon_provider.dart';
import 'package:buzz/shared/community/community_provider.dart';
import 'package:buzz/shared/platform/tenant_profile_live.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:buzz/shared/widgets/avatar_image.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../helpers/widget_helpers.dart';

void main() {
  testWidgets(
    'terminal profile clear removes live and cached identity from the actual theme preview',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final profiles = StreamController<TenantProfileView?>();
      addTearDown(profiles.close);
      await tester.pumpWidget(
        WidgetHelpers.testable(
          child: const ThemePickerPage(),
          overrides: [
            savedPrefsProvider.overrideWithValue(prefs),
            activeCommunityProvider.overrideWith(
              (ref) async => Community(
                id: 'cached',
                name: 'Cached identity',
                relayUrl: 'wss://relay.test',
                addedAt: DateTime(2026),
              ),
            ),
            communityIconProvider.overrideWith(
              (ref, relay) async => 'https://relay.test/old-icon.png',
            ),
            tenantProfileLiveProvider.overrideWith((ref) => profiles.stream),
          ],
        ),
      );
      profiles.add(
        TenantProfileView(name: 'Admitted identity', version: 1, icon: '🎉'),
      );
      await tester.pumpAndSettle();
      expect(find.text('Admitted identity'), findsWidgets);
      expect(find.text('🎉'), findsWidgets);
      profiles.add(null);
      await tester.pumpAndSettle();
      expect(find.text('Admitted identity'), findsNothing);
      expect(find.text('Cached identity'), findsNothing);
      expect(find.text('🎉'), findsNothing);
      final icons = tester.widgetList<AvatarImage>(
        find.byKey(const ValueKey('theme-preview-community-icon')),
      );
      expect(icons, isNotEmpty);
      expect(icons.every((icon) => icon.imageUrl == null), isTrue);
    },
  );
}
