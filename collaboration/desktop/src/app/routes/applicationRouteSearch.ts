import { validComponentPath } from "@client-kit/platform/react/native-deep-link";

export type ApplicationRouteSearch = {
  workspaceId?: string;
  /**
   * DD-138(4)(5), 07 §4.8.3/§4.8.4: relative location inside the native page (an Inbox component
   * notification or a 「搜索全部」 component result). Same rule as the Web host's `path` search
   * param; a malformed path is dropped and the page opens at its entry (origin re-checked at launch).
   */
  path?: string;
};

export function applicationRouteSearch(
  search: Record<string, unknown>,
): ApplicationRouteSearch {
  return {
    workspaceId:
      typeof search.workspaceId === "string" && search.workspaceId.trim()
        ? search.workspaceId
        : undefined,
    path: validComponentPath(search.path) ? search.path : undefined,
  };
}
