// The original Agent editor is shared. Only the authenticated Web media
// transport and exact server-projected image paths differ from the native host.
import { useMemo, useRef, type ComponentProps } from "react";
import { AgentDefinitionsPage } from "@client-kit/platform/react/pages";
import { useBffClient, useLocale, useT } from "@client-kit/platform/react/context";
import { useLoad } from "@client-kit/platform/react/use-load";
import { ReadFailure } from "@client-kit/platform/react/ui";
import { uploadProfileAvatar } from "../bff-client";

type AgentProps = NonNullable<ComponentProps<typeof AgentDefinitionsPage>>;
type Props = Pick<AgentProps, "workspaceId" | "onWorkspaceChange">;

export function AgentDefinitionsPane(props: Props) {
  const client = useBffClient();
  const locale = useLocale();
  const t = useT();
  const [loaded, reload] = useLoad("agent-avatar-actor", client.profile);
  const uploadedPaths = useRef<Record<string, string>>({});
  const actor = loaded.status === "ok" ? loaded.data : null;
  const avatarHost = useMemo<AgentProps["avatarHost"]>(() => actor ? (version) => ({
    locale,
    uploadMediaBytes: async (bytes) => {
      const descriptor = await uploadProfileAvatar(bytes, actor.pubkey);
      uploadedPaths.current[descriptor.url] = `/api/v1/profile/media/${descriptor.sha256}`;
      return descriptor;
    },
    rewriteMediaUrl: (url) => {
      const paths = version?.avatarMediaPaths;
      const clean = url.split("?")[0]!;
      return uploadedPaths.current[url] ?? paths?.[url] ?? actor.avatarMediaPaths[url]
        ?? uploadedPaths.current[clean] ?? paths?.[clean] ?? actor.avatarMediaPaths[clean] ?? url;
    },
    performDefaultHaptic: () => {},
  }) : undefined, [actor, locale]);
  if (loaded.status === "pending") return <p role="status">{t("platform.loading")}</p>;
  if (loaded.status === "error") return <ReadFailure error={loaded.error} onRetry={reload} />;
  return <AgentDefinitionsPage key={loaded.data.pubkey} {...props} avatarHost={avatarHost} />;
}
