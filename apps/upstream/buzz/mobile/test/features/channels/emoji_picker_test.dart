import 'package:buzz/features/channels/emoji_picker.dart';
import 'package:buzz/features/channels/recent_emoji_provider.dart';
import 'package:buzz/shared/emoji/emoji_data.dart';
import 'package:buzz/shared/emoji/emoji_data_provider.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../helpers/widget_helpers.dart';

EmojiEntry _entry(
  String id, {
  required String native,
  required String categoryId,
  String? name,
  List<String> keywords = const [],
  int skinIndex = 0,
}) => EmojiEntry(
  id: id,
  name: name ?? id,
  keywords: keywords,
  native: native,
  categoryId: categoryId,
  skinIndex: skinIndex,
);

/// A miniature stand-in for the generated asset — two categories so the rail
/// has something to switch between. `emoji_data_test.dart` covers the real one.
final _dataset = () {
  final people = [
    _entry('grinning', native: '\u{1F600}', categoryId: 'people'),
    _entry(
      'point_up',
      native: '\u{261D}\u{FE0F}',
      categoryId: 'people',
      name: 'Index Pointing Up',
    ),
    _entry(
      'point_up',
      native: '\u{261D}\u{1F3FB}',
      categoryId: 'people',
      name: 'Index Pointing Up',
      skinIndex: 1,
    ),
    _entry(
      'point_up',
      native: '\u{261D}\u{1F3FC}',
      categoryId: 'people',
      name: 'Index Pointing Up',
      skinIndex: 2,
    ),
    _entry(
      'point_up',
      native: '\u{261D}\u{1F3FD}',
      categoryId: 'people',
      name: 'Index Pointing Up',
      skinIndex: 3,
    ),
    _entry(
      'point_up',
      native: '\u{261D}\u{1F3FE}',
      categoryId: 'people',
      name: 'Index Pointing Up',
      skinIndex: 4,
    ),
    _entry(
      'point_up',
      native: '\u{261D}\u{1F3FF}',
      categoryId: 'people',
      name: 'Index Pointing Up',
      skinIndex: 5,
    ),
  ];
  final nature = [
    _entry(
      'fire',
      native: '\u{1F525}',
      categoryId: 'nature',
      name: 'Fire',
      keywords: const ['flame'],
    ),
  ];
  final all = [...people, ...nature];
  return EmojiDataset(
    categories: [
      EmojiCategory(id: 'people', emoji: people),
      EmojiCategory(id: 'nature', emoji: nature),
    ],
    all: all,
    nativeToShortcode: {for (final entry in all) entry.native: ':${entry.id}:'},
  );
}();

/// A dataset tall enough that the grid actually scrolls, so rail navigation has
/// somewhere to go. [_dataset] fits on one screen and clamps to offset 0.
final _tallDataset = () {
  final people = [
    for (var i = 0; i < 200; i++)
      _entry('people_$i', native: '\u{1F600}', categoryId: 'people'),
  ];
  // Nature is tall too, so the People target isn't clamped by the end of the
  // list — this test is about landing on a header, not about the clamp.
  final nature = [
    _entry('fire', native: '\u{1F525}', categoryId: 'nature'),
    for (var i = 0; i < 200; i++)
      _entry('nature_$i', native: '\u{1F33F}', categoryId: 'nature'),
  ];
  final all = [...people, ...nature];
  return EmojiDataset(
    categories: [
      EmojiCategory(id: 'people', emoji: people),
      EmojiCategory(id: 'nature', emoji: nature),
    ],
    all: all,
    nativeToShortcode: {for (final entry in all) entry.native: ':${entry.id}:'},
  );
}();

Future<SharedPreferences> _prefs() {
  SharedPreferences.setMockInitialValues({});
  return SharedPreferences.getInstance();
}

Future<List<String>> _pumpPicker(
  WidgetTester tester, {
  required SharedPreferences prefs,
  EmojiDataset? dataset,
}) async {
  final selected = <String>[];
  await tester.pumpWidget(
    WidgetHelpers.testable(
      overrides: [
        savedPrefsProvider.overrideWithValue(prefs),
        myPubkeyProvider.overrideWithValue('self'),
        emojiDatasetOrEmptyProvider.overrideWithValue(dataset ?? _dataset),
      ],
      child: EmojiPickerSheet(onSelect: selected.add),
    ),
  );
  await tester.pumpAndSettle();
  return selected;
}

void main() {
  group('EmojiPickerSheet', () {
    testWidgets('with no history there is no Frequently used section', (
      tester,
    ) async {
      await _pumpPicker(tester, prefs: await _prefs());

      // An empty section in a continuous list is a labelled gap, and its rail
      // entry would lead nowhere — so it is omitted until something is picked.
      expect(find.byTooltip('Frequently used'), findsNothing);
      expect(find.text('Frequently used'), findsNothing);
      expect(find.byKey(const ValueKey('emoji-picker-grid')), findsOneWidget);
    });

    testWidgets(
      'search shares the sheet header with the shared close control',
      (tester) async {
        await _pumpPicker(tester, prefs: await _prefs());

        final search = tester.getRect(
          find.byKey(const ValueKey('emoji-picker-search')),
        );
        final close = tester.getRect(find.byTooltip('Close sheet'));

        expect(close.size, const Size.square(44));
        expect(search.center.dy, close.center.dy);
        expect(close.left - search.right, Grid.xxs);
      },
    );

    testWidgets('the Flutter picker keeps the established tray height', (
      tester,
    ) async {
      await _pumpPicker(tester, prefs: await _prefs());

      final picker = find.byType(EmojiPickerSheet);
      final context = tester.element(picker);
      expect(
        tester.getSize(picker).height,
        closeTo(MediaQuery.sizeOf(context).height * 0.62, 0.5),
      );
      expect(find.byType(DraggableScrollableSheet), findsNothing);
    });

    testWidgets('the Flutter search field is a full pill', (tester) async {
      await _pumpPicker(tester, prefs: await _prefs());

      final field = tester.widget<TextField>(
        find.byKey(const ValueKey('emoji-picker-search')),
      );
      final border = field.decoration!.border! as OutlineInputBorder;
      expect(border.borderRadius, BorderRadius.circular(Radii.full));
    });

    testWidgets('crosses the shortcode separator emoji-mart cannot', (
      tester,
    ) async {
      await _pumpPicker(tester, prefs: await _prefs());

      await tester.enterText(
        find.byKey(const ValueKey('emoji-picker-search')),
        'pointup',
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('emoji-tile-point_up')), findsOneWidget);
    });

    testWidgets('reports no results rather than an empty grid', (tester) async {
      await _pumpPicker(tester, prefs: await _prefs());

      await tester.enterText(
        find.byKey(const ValueKey('emoji-picker-search')),
        'zzzzzz',
      );
      await tester.pumpAndSettle();

      expect(find.text('No emoji found.'), findsOneWidget);
    });

    testWidgets('clear button restores browsing', (tester) async {
      await _pumpPicker(tester, prefs: await _prefs());

      await tester.enterText(
        find.byKey(const ValueKey('emoji-picker-search')),
        'fire',
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('emoji-picker-search-clear')));
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('emoji-picker-search-results')),
        findsNothing,
      );
      expect(find.byTooltip('Smileys & People'), findsOneWidget);
    });

    testWidgets(
      'changing skin tone keeps the scrolled-to category highlighted',
      (tester) async {
        // A skin-tone change rebuilds the sections and the active-section
        // notifier. Regression: the notifier was recreated at index 0, so a
        // user parked on a later category snapped back to the first one in the
        // rail while the grid stayed put. The notifier now seeds from the live
        // scroll offset, so the highlight survives the rebuild.
        await _pumpPicker(tester, prefs: await _prefs(), dataset: _tallDataset);
        final colors = Theme.of(
          tester.element(find.byType(EmojiPickerSheet)),
        ).colorScheme;
        Color iconColor(String tooltip) => tester
            .widget<Icon>(
              find.descendant(
                of: find.byTooltip(tooltip),
                matching: find.byType(Icon),
              ),
            )
            .color!;

        await tester.tap(find.byTooltip('Animals & Nature'));
        await tester.pumpAndSettle();
        expect(iconColor('Animals & Nature'), colors.primary);
        expect(iconColor('Smileys & People'), colors.onSurfaceVariant);

        await tester.tap(find.byTooltip('Skin tone'));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('emoji-skin-tone-3')));
        await tester.pumpAndSettle();

        // Still on Nature after the tone rebuild — not reset to People.
        expect(iconColor('Animals & Nature'), colors.primary);
        expect(iconColor('Smileys & People'), colors.onSurfaceVariant);
      },
    );

    testWidgets('a standard emoji emits its glyph', (tester) async {
      final selected = await _pumpPicker(tester, prefs: await _prefs());

      await tester.tap(find.byTooltip('Animals & Nature'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('emoji-tile-fire')));
      await tester.pumpAndSettle();

      expect(selected, ['\u{1F525}']);
    });

    testWidgets('skin tone choice shows and emits one selected variant', (
      tester,
    ) async {
      final selected = await _pumpPicker(tester, prefs: await _prefs());

      expect(find.byKey(const ValueKey('emoji-tile-point_up')), findsOneWidget);
      expect(find.byKey(const ValueKey('emoji-tile-point_up-1')), findsNothing);

      await tester.tap(find.byTooltip('Skin tone'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('emoji-skin-tone-3')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('emoji-tile-point_up')));
      await tester.pumpAndSettle();

      expect(selected, ['\u{261D}\u{1F3FD}']);
    });

    testWidgets('skin tone choices paint their colors on a solid layer', (
      tester,
    ) async {
      await _pumpPicker(tester, prefs: await _prefs());

      await tester.tap(find.byTooltip('Skin tone'));
      await tester.pumpAndSettle();

      const expectedColors = [
        Color(0xFFFFC93A),
        Color(0xFFFFDAB7),
        Color(0xFFE7B98F),
        Color(0xFFC88C61),
        Color(0xFFA46134),
        Color(0xFF5D4437),
      ];
      for (final (index, expectedColor) in expectedColors.indexed) {
        final decorations = tester
            .widgetList<DecoratedBox>(
              find.descendant(
                of: find.byKey(ValueKey('emoji-skin-tone-dot-$index')),
                matching: find.byType(DecoratedBox),
              ),
            )
            .map((widget) => widget.decoration)
            .whereType<BoxDecoration>();

        expect(
          decorations.any(
            (decoration) =>
                decoration.color == expectedColor &&
                decoration.gradient == null &&
                decoration.backgroundBlendMode == null,
          ),
          isTrue,
        );
      }
    });

    testWidgets('a non-reaction selection does not record a quick reaction', (
      tester,
    ) async {
      final prefs = await _prefs();
      final selected = await _pumpPicker(tester, prefs: prefs);

      await tester.tap(find.byTooltip('Animals & Nature'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('emoji-tile-fire')));
      await tester.pumpAndSettle();

      expect(selected, ['\u{1F525}']);
      expect(
        prefs.getString(
          'buzz.quick-reaction-emojis.v1:http://localhost:3000:self',
        ),
        isNull,
      );
    });
  });

  group('iOS native emoji picker', () {
    setUp(resetIosEmojiPickerPresentationForTest);
  });

  group('recent emoji ranking', () {
    test('promotes by use count, breaking ties on recency', () {
      var entries = <RecentEmojiEntry>[];
      entries = recordRecentEmoji(entries, 'a', now: 10);
      entries = recordRecentEmoji(entries, 'b', now: 20);
      entries = recordRecentEmoji(entries, 'b', now: 30);
      entries = recordRecentEmoji(entries, 'c', now: 40);

      expect(entries.map((entry) => entry.emoji), ['b', 'c', 'a']);
      expect(entries.first.count, 2);
    });
  });
}
