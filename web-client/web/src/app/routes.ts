import { index, layout, rootRoute, route } from "@tanstack/virtual-file-routes";

// One existing TanStack history, as in Buzz's native AppShell. The shared host
// stays mounted while navigating; only existing admitted pages are routable.
export const routes = rootRoute("root.tsx", [
  layout("platform.tsx", [
    index("index.tsx"),
    route("/$section", "section.tsx"),
    route("/channels/$channelId", "channels.$channelId.tsx"),
    route("/conversations/$conversationId", "conversations.$conversationId.tsx"),
    route("/messages/new", "messages.new.tsx"),
    route("/applications/$bindingId", "applications.$bindingId.tsx"),
  ]),
  route("/invite", "invite.tsx"),
]);
