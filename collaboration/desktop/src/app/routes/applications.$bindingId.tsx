import { createFileRoute } from "@tanstack/react-router";
import { NativeApplicationPage } from "@client-kit/platform/react/native-application-page";

export const Route = createFileRoute("/applications/$bindingId")({
  validateSearch: (search: Record<string, unknown>): { workspaceId?: string } => ({
    workspaceId: typeof search.workspaceId === "string" && search.workspaceId.trim() ? search.workspaceId : undefined,
  }),
  component: NativeApplicationRoute,
});

function NativeApplicationRoute() {
  const { bindingId } = Route.useParams();
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-6 pt-14">
    {/* DD-138(3): a Kailo page, no Back/Refresh chrome around the component. */}
    <NativeApplicationPage key={bindingId} bindingId={bindingId} />
  </div>;
}
