import 'package:buzz/features/forum/forum_text.dart';
import 'package:buzz/shared/relay/relay_publish_failure.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _host(Locale locale, void Function(BuildContext context) onPressed) =>
    MaterialApp(
      theme: AppTheme.light(),
      home: Scaffold(
        body: Builder(
          builder: (context) => Localizations.override(
            context: context,
            locale: locale,
            child: Builder(
              builder: (inner) => TextButton(
                onPressed: () => onPressed(inner),
                child: Text(
                  forumReplyCount(inner, 2),
                  key: const ValueKey('count'),
                ),
              ),
            ),
          ),
        ),
      ),
    );

void main() {
  testWidgets('forum copy follows the view locale from the shared catalog', (
    tester,
  ) async {
    await tester.pumpWidget(_host(const Locale('zh', 'CN'), (_) {}));
    expect(find.text('2 条回复'), findsOneWidget);
    await tester.pumpWidget(_host(const Locale('en'), (_) {}));
    expect(find.text('2 replies'), findsOneWidget);
  });

  testWidgets('an unknown deletion outcome is never shown as success', (
    tester,
  ) async {
    await tester.pumpWidget(
      _host(
        const Locale('en'),
        (context) => showForumDeleteFailure(
          context,
          const RelayPublishOutcomeUnknown('evt', 'timeout'),
        ),
      ),
    );
    await tester.tap(find.byKey(const ValueKey('count')));
    await tester.pump();
    expect(
      find.text(
        platformText(PlatformMessageKey.forumDeleteUnknown, locale: 'en'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('a rejected deletion says the content was not removed', (
    tester,
  ) async {
    await tester.pumpWidget(
      _host(
        const Locale('zh', 'CN'),
        (context) => showForumDeleteFailure(context, StateError('rejected')),
      ),
    );
    await tester.tap(find.byKey(const ValueKey('count')));
    await tester.pump();
    expect(
      find.text(
        platformText(PlatformMessageKey.forumDeleteRejected, locale: 'zh-CN'),
      ),
      findsOneWidget,
    );
  });
}
