import { useHomeShortcut } from "@client-kit/platform/react/use-navigation-shortcuts";
import { useSearchShortcuts } from "@client-kit/platform/react/use-search-shortcuts";

type AppShellKeyboardShortcutsOptions = {
  canSearchCurrentChannel: boolean;
  disabled: boolean;
  onGoHome: () => unknown;
  onSearchCurrentChannel: () => void;
  onSearchEverything: () => void;
};

export function useAppShellKeyboardShortcuts({ onGoHome, ...options }: AppShellKeyboardShortcutsOptions) {
  useHomeShortcut({ disabled: options.disabled, onGoHome });
  useSearchShortcuts(options);
}
