import { ThemeSettingsControls } from "@client-kit/platform/react/theme-settings-controls";
import { isBuzzTheme } from "@client-kit/platform/theme/use-appearance";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "@client-kit/platform/i18n";
import { ConversationDisplaySettings } from "@client-kit/platform/react/conversation-display-settings";
import { ProminentActiveTabSetting } from "@client-kit/platform/react/prominent-active-tab-setting";
import {
  SettingsPage,
  ShortcutSettings,
  type SettingsSection,
} from "@client-kit/platform/react/settings";
import { setWorkspacePreference } from "@/platform/bff-client";
import { getLocale } from "@/shared/i18n";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { Button } from "@/shared/ui/button";
import { platformQueries } from "./queries";

export function SettingsPane() {
  const locale = getLocale();
  const appearance = useTheme();
  const [section, setSection] = useState<SettingsSection>("appearance");
  return (
    <SettingsPage locale={locale} section={section} onSelect={setSection}>
      {section === "appearance" ? (
        <div className="flex flex-col gap-6">
          <ThemeSettingsControls locale={locale} name={translate(locale, "platform.title")} appearance={appearance}>
            {isBuzzTheme(appearance.themeName) ? <ProminentActiveTabSetting locale={locale} prominentActiveTab={appearance.prominentActiveTab} setProminentActiveTab={appearance.setProminentActiveTab} /> : null}
          </ThemeSettingsControls>
          <ConversationDisplaySettings locale={locale} />
        </div>
      ) : section === "notifications" ? (
        <WorkspaceNotifications />
      ) : (
        <ShortcutSettings
          locale={locale}
          shortcuts={[
            // The Web composer is a single-line Input, not Desktop's rich editor.
            {
              id: "send-message",
              label: translate(locale, "platform.settings.sendShortcut"),
              keys: "Enter",
            },
          ]}
        />
      )}
    </SettingsPage>
  );
}

export function WorkspaceNotifications() {
  const locale = getLocale();
  const queryClient = useQueryClient();
  const workspaces = useQuery(platformQueries.workspaces);
  const userState = useQuery(platformQueries.userState);
  const writing = useRef(false);
  const mutation = useMutation({
    mutationFn: async ({ id, muted }: { id: string; muted: boolean }) => {
      if (
        writing.current ||
        !workspaces.isSuccess ||
        !userState.isSuccess ||
        workspaces.isFetching ||
        userState.isFetching ||
        !workspaces.data.some((workspace) => workspace.id === id)
      )
        return;
      writing.current = true;
      try {
        await setWorkspacePreference(id, {
          starred: userState.data.workspacePreferences[id]?.starred ?? false,
          muted,
          version: userState.data.version,
        });
      } finally {
        // Read the original CAS authority after either success or a lost response.
        // Do not optimistically invert, replay the write, or assume default state.
        await queryClient.invalidateQueries({ queryKey: platformQueries.userState.queryKey });
        writing.current = false;
      }
    },
  });
  const ready =
    workspaces.isSuccess && userState.isSuccess && !workspaces.isFetching && !userState.isFetching;
  const failed = workspaces.isError || userState.isError || mutation.isError;
  async function refresh() {
    const [ws, prefs] = await Promise.all([workspaces.refetch(), userState.refetch()]);
    if (ws.isSuccess && prefs.isSuccess) mutation.reset();
  }
  return (
    <section className="flex flex-col gap-4" data-testid="workspace-notifications">
      <div>
        <h2 className="text-lg font-semibold">
          {translate(locale, "platform.settings.workspaceNotifications")}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {translate(locale, "platform.settings.workspaceNotificationsDescription")}
        </p>
      </div>
      {failed ? (
        <div role="status">
          <p>{translate(locale, "platform.loadFailed")}</p>
          <Button
            type="button"
            disabled={mutation.isPending || workspaces.isFetching || userState.isFetching}
            onClick={() => void refresh()}
          >
            {translate(locale, "platform.retry")}
          </Button>
        </div>
      ) : !ready ? (
        <p role="status">{translate(locale, "platform.loadingWorkspaces")}</p>
      ) : null}
      {ready && workspaces.data.length === 0 ? (
        <p>{translate(locale, "platform.noWorkspace")}</p>
      ) : null}
      {ready ? (
        <ul className="divide-y divide-border">
          {workspaces.data.map((workspace) => (
            <li
              key={workspace.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <span className="min-w-0 flex-1 break-words">{workspace.name}</span>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={userState.data.workspacePreferences[workspace.id]?.muted ?? false}
                  disabled={failed || mutation.isPending}
                  onChange={(event) =>
                    mutation.mutate({ id: workspace.id, muted: event.target.checked })
                  }
                />
                {translate(locale, "platform.settings.muted")}
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
