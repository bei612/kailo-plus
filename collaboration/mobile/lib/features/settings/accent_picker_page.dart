import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/theme/theme.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import 'theme_option_sheets.dart';

/// Accent colors as a list of rows, matching the theme picker's shape. The
/// swatches used to live inline on the settings page as a wrap of tappable
/// circles; a row per color keeps the settings page to plain rows and gives each
/// accent a readable name.
///
/// Kailo: names come from the platform message table and the choice stays a
/// device preference (DD-53).
class AccentPickerPage extends ConsumerWidget {
  const AccentPickerPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final selected =
        accentIndexForWireValue(ref.watch(communityThemeProvider).accent) ??
        defaultAccentIndex;
    final colorScheme = context.colors;

    return FrostedScaffold(
      useUtilitySurfaceTheme: true,
      appBar: FrostedAppBar(
        centerTitle: true,
        title: Text(
          platformText(
            PlatformMessageKey.platformThemeAccentColor,
            locale: locale,
          ),
        ),
      ),
      body: ListView(
        padding: EdgeInsets.only(
          top: frostedAppBarHeight(context),
          bottom: Grid.xs,
        ),
        children: [
          for (var i = 0; i < accentColors.length; i++)
            _AccentRow(
              color: accentColorForScheme(colorScheme, i),
              label: accentColorLabel(i, locale: locale),
              selected: selected == i,
              onTap: () =>
                  ref.read(communityThemeProvider.notifier).setAccent(i),
            ),
        ],
      ),
    );
  }
}

class _AccentRow extends StatelessWidget {
  const _AccentRow({
    required this.color,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final Color color;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Container(
        width: 28,
        height: 28,
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
          border: Border.all(color: context.colors.outlineVariant),
        ),
      ),
      title: Text(label),
      trailing: selected
          ? Icon(LucideIcons.check, size: 18, color: context.colors.primary)
          : null,
      onTap: onTap,
    );
  }
}
