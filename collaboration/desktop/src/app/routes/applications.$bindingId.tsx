import { createFileRoute } from "@tanstack/react-router";
import { NativeApplicationPage } from "@client-kit/platform/react/native-application-page";
import { applicationRouteSearch } from "./applicationRouteSearch";

export const Route = createFileRoute("/applications/$bindingId")({
  validateSearch: applicationRouteSearch,
  component: NativeApplicationRoute,
});

function NativeApplicationRoute() {
  const { bindingId } = Route.useParams();
  // DD-138(4)(5), 07 §4.8.3/§4.8.4: optional deep link (Inbox item / search result) inside the native page.
  const { path } = Route.useSearch();
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-6 pt-14">
    {/* DD-138(3): a Kailo page, no Back/Refresh chrome around the component. */}
    <NativeApplicationPage key={bindingId} bindingId={bindingId} path={path} />
  </div>;
}
