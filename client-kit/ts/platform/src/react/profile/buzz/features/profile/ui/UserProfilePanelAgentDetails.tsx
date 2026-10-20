// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/ui/UserProfilePanelAgentDetails.tsx: the configuration and
// instructions focused views.
// Kailo: DD-26 leaves only the RuntimeProfile key as runtime configuration (no local ACP/MCP
// command); the instructions are the pinned AgentVersion's (17 §3/§8, Definition `read`) and render
// through the host Markdown seam the transcript already uses (plain text without one).
import { useUiT } from "../../../../../context";
import { TranscriptMarkdown } from "../../../../../agent-transcript/host";
import {
  type ProfileField,
  type ProfileFieldKey,
  ProfileFieldRows,
} from "./UserProfilePanelFields";

export const AGENT_DETAILS_FIELD_KEYS = new Set<ProfileFieldKey>(["runtime"]);

export function AgentConfigurationFocusedView({
  fields,
}: {
  fields: ProfileField[];
}) {
  const runtimeConfigurationFields = fields.filter((field) =>
    AGENT_DETAILS_FIELD_KEYS.has(field.key),
  );

  if (runtimeConfigurationFields.length === 0) {
    return null;
  }

  return (
    <div className="pt-4">
      <div className="overflow-hidden rounded-2xl bg-muted/20">
        <ProfileFieldRows fields={runtimeConfigurationFields} />
      </div>
    </div>
  );
}

export function AgentInstructionsFocusedView({
  instruction,
}: {
  instruction: string | null;
}) {
  const t = useUiT();
  const trimmedInstruction = instruction?.trim() ?? "";

  return (
    <div className="pt-4">
      <div
        className="rounded-2xl bg-muted/20 px-4 py-3"
        data-testid="user-profile-agent-instructions-view"
      >
        {trimmedInstruction ? (
          <TranscriptMarkdown
            className="text-sm leading-6"
            content={trimmedInstruction}
          />
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            {t("platform.profile.noInstruction")}
          </p>
        )}
      </div>
    </div>
  );
}
