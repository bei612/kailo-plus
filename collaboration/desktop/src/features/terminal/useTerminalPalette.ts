// DD-161 / DD-141: the original terminal palette contract (shared/theme/terminal-palette.ts),
// fed from the Kailo design tokens for the first-party theme instead of Buzz's palette;
// other syntax themes keep the original Shiki derivation.
import * as React from "react";
import type { ThemeRegistrationRaw } from "shiki";
import { kailoRoles, type KailoMode } from "@client-kit/platform/theme/kailo-tokens";
import { isBuzzTheme } from "@client-kit/platform/theme/use-appearance";
import { loadThemeData, SYNTAX_THEMES, type SyntaxThemeName } from "@client-kit/platform/theme/theme-loader";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { extractTerminalPalette, type TerminalPalette } from "@/shared/theme/terminal-palette";

/** The Kailo surface, text, brand and status roles expressed as a terminal theme. */
export function kailoTerminalTheme(mode: KailoMode): ThemeRegistrationRaw {
  const r = kailoRoles(mode);
  return {
    name: `kailo-terminal-${mode}`,
    type: mode,
    colors: {
      "editor.background": r.surface,
      "editor.foreground": r.text,
      "terminal.ansiRed": r.danger,
      "terminal.ansiGreen": r.success,
      "terminal.ansiYellow": r.warning,
      "terminal.ansiBlue": r.info,
      "terminal.ansiMagenta": r.brand,
      "terminalCursor.foreground": r.brand,
      "terminalCursor.background": r.surface,
    },
    settings: [],
  } as ThemeRegistrationRaw;
}

export function useTerminalPalette(): TerminalPalette | null {
  const { themeName, isDark } = useTheme();
  const firstParty = isBuzzTheme(themeName);
  const [palette, setPalette] = React.useState<TerminalPalette | null>(() =>
    firstParty ? extractTerminalPalette(kailoTerminalTheme(isDark ? "dark" : "light")) : null);
  React.useEffect(() => {
    if (firstParty) {
      setPalette(extractTerminalPalette(kailoTerminalTheme(isDark ? "dark" : "light")));
      return;
    }
    if (!(SYNTAX_THEMES as readonly string[]).includes(themeName)) {
      setPalette(extractTerminalPalette(kailoTerminalTheme(isDark ? "dark" : "light")));
      return;
    }
    let current = true;
    void loadThemeData(themeName as SyntaxThemeName)
      .then((theme) => { if (current) setPalette(extractTerminalPalette(theme)); })
      .catch(() => { if (current) setPalette(extractTerminalPalette(kailoTerminalTheme(isDark ? "dark" : "light"))); });
    return () => { current = false; };
  }, [firstParty, isDark, themeName]);
  return palette;
}
