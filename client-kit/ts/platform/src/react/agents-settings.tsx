// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/settings/ui/AgentsSettingsPanel.tsx: the Conversations group's
// "Automatically mention agents" device preference, consumed by the shared composer
// (useThreadAgentAudience). The original's Prevent sleep (host power), Harnesses (DD-26) and
// Agent defaults (no governed action) cards are not rendered here.
import { useUiT } from "./context";
import {
  setKeepMentionedAgentsPinned,
  useKeepMentionedAgentsPinned,
} from "./composer/features/messages/lib/autoPinMentionedAgentsPreference";
import { SettingsOptionGroup, SettingsOptionGroupList, SettingsOptionRow } from "./settings-option-group";
import { SettingsSectionHeader } from "./settings-surface";
import { Switch } from "./switch";

export function AgentsSettingsPanel() {
  const t = useUiT();
  const automaticallyMentionAgents = useKeepMentionedAgentsPinned();
  return (
    <section className="min-w-0" data-testid="settings-agents">
      <SettingsSectionHeader
        title={t("platform.settings.agents")}
        description={t("platform.settings.agentsDescription")}
      />
      <SettingsOptionGroupList>
        <SettingsOptionGroup title={t("platform.settings.agentsConversations")}>
          <SettingsOptionRow data-testid="settings-automatic-agent-mentions">
            <div className="min-w-0">
              <label className="font-medium text-foreground" htmlFor="settings-automatic-agent-mentions-switch">
                {t("platform.settings.automaticAgentMentions")}
              </label>
              <p className="mt-0.5 text-sm text-muted-foreground/70" data-settings-subcopy>
                {t("platform.settings.automaticAgentMentionsDescription")}
              </p>
            </div>
            <Switch
              aria-label={t("platform.settings.automaticAgentMentions")}
              checked={automaticallyMentionAgents}
              id="settings-automatic-agent-mentions-switch"
              onCheckedChange={setKeepMentionedAgentsPinned}
            />
          </SettingsOptionRow>
        </SettingsOptionGroup>
      </SettingsOptionGroupList>
    </section>
  );
}
