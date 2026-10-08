import { TopbarSearch as SharedTopbarSearch, type TopbarSearchProps } from "@client-kit/platform/react/search/TopbarSearch";
import { useSearchResults } from "@/features/search/useSearchResults";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";

export function TopbarSearch(props: Omit<TopbarSearchProps, "useResults" | "resolveMediaUrl">) {
  return <SharedTopbarSearch {...props} useResults={useSearchResults} resolveMediaUrl={rewriteRelayUrl} />;
}
