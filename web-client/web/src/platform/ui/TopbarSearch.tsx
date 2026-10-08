import { TopbarSearch as SharedTopbarSearch, type TopbarSearchProps } from "@client-kit/platform/react/search/TopbarSearch";
import { useWebSearchReader } from "./search";

/** Original full search dialog, not a separately implemented Web page. */
export function TopbarSearch({scopeKey,directoryError,...props}:Omit<TopbarSearchProps,"useResults">&{scopeKey:string;directoryError?:unknown}) {
  const useResults=useWebSearchReader(scopeKey,directoryError);
  return <SharedTopbarSearch key={scopeKey} {...props} useResults={useResults}/>;
}
