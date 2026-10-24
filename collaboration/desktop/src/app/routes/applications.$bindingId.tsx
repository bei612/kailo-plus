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
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-14">
    {/* DD-138(3)/DD-152: a Kailo page; Kailo's page header and the component content run edge to edge. */}
    <NativeApplicationPage key={bindingId} bindingId={bindingId} path={path} />
  </div>;
}
