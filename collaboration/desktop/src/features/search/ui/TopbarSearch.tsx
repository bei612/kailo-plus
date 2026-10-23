import { TopbarSearch as SharedTopbarSearch, type TopbarSearchProps } from "@client-kit/platform/react/search/TopbarSearch";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useSearchResults } from "@/features/search/useSearchResults";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";

export function TopbarSearch(props: Omit<TopbarSearchProps, "useResults" | "resolveMediaUrl">) {
  const { goApplication } = useAppNavigation();
  // DD-138(5), 07 §4.8.4: a component result opens its category's native page entry (binding
  // resolved by Core) at the result's relative path, like the Web host.
  return <SharedTopbarSearch {...props} useResults={useSearchResults} resolveMediaUrl={rewriteRelayUrl}
    onOpenComponent={props.onOpenComponent ?? ((result) => { void goApplication(result.bindingId, undefined, result.path); })} />;
}
