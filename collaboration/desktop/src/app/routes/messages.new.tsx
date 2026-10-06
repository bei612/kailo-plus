import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useBffClient, useT } from "@client-kit/platform/react/context";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { NewMessagePage } from "@/features/messages/ui/NewMessagePage";

export const Route = createFileRoute("/messages/new")({ component: NewMessageRoute,
  validateSearch: (search: Record<string, unknown>): {pubkey?:string} => ({
    pubkey: typeof search.pubkey === "string" && /^[0-9a-f]{64}$/.test(search.pubkey) ? search.pubkey : undefined,
  }),
});
function NewMessageRoute() {
  const {pubkey} = Route.useSearch();
  const client = useBffClient();
  const t = useT();
  const { goChannel } = useAppNavigation();
  const session = useQuery({ queryKey: ["platform", "session"], queryFn: () => client.session() });
  if (!session.data) return <p role={session.isError ? "alert" : "status"}>{t(session.isError ? "platform.loadFailed" : "platform.loading")}</p>;
  return <NewMessagePage currentPrincipalId={session.data.tenantPrincipalId} initialRecipientPubkey={pubkey}
    onConversationOpened={async (conversation) => { await goChannel(conversation.channelId, { replace: true }); }} />;
}
