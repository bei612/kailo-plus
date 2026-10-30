import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';
import {
  useDeleteThreadMutation,
  useThreadsQuery,
  useUpdateThreadMutation,
} from '@/apollo/client/graphql/home.generated';
import useKailoSession from '@/hooks/useKailoSession';
import useGlobalConfig from '@/hooks/useGlobalConfig';
import { notify } from '@/utils/kailoHost';
import { kailoT } from '@/utils/kailoI18n';
import { PANE_PAGE_SIZE, clampPage, pageCount } from '@/utils/kailoList';

// DD-167 (`20` §15.1/§15.3): the thread pane of 问答 — a server-paged list
// (recent activity first) whose page lives in the route query (`tp`), so it
// stays on the same page while moving between threads.
const PANE_QUERY = 'tp';

export const panePage = (query: Record<string, unknown> | undefined) => {
  const value = Number.parseInt(String(query?.[PANE_QUERY] ?? ''), 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
};

export default function useHomeSidebar() {
  const router = useRouter();
  const { isAdmin } = useKailoSession();
  const { config } = useGlobalConfig();
  const page = panePage(router.query);
  const { data, previousData, loading, error, refetch } = useThreadsQuery({
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
    variables: {
      pagination: {
        offset: (page - 1) * PANE_PAGE_SIZE,
        limit: PANE_PAGE_SIZE,
      },
    },
  });
  // Paging keeps the previous rows on screen (dimmed) until the next arrive.
  const shown = data || previousData;
  const total = shown?.threadPage?.total ?? 0;
  const pages = pageCount(total, PANE_PAGE_SIZE);
  const [updateThread] = useUpdateThreadMutation({
    onError: (error) => console.error(error),
  });
  const [deleteThread] = useDeleteThreadMutation({
    onError: (error) => console.error(error),
  });

  const threads = useMemo(
    () =>
      (shown?.threadPage?.items || []).map((thread) => ({
        id: thread.id.toString(),
        name: thread.summary,
        // DD-133 §3: the Kailo user who started the thread. Renaming and
        // deleting are its creator's (STANDALONE) or an admin's.
        owner: thread.owner,
        canManage:
          isAdmin ||
          (config?.nativeBindingConfigured === false &&
            thread.owner?.isCurrentUser === true),
      })),
    [shown, isAdmin, config],
  );

  const routeWith = (pathname: string, query: Record<string, string>) => ({
    pathname,
    query: page > 1 ? { ...query, [PANE_QUERY]: String(page) } : query,
  });

  const setPage = (next: number) => {
    const target = clampPage(next, total, PANE_PAGE_SIZE);
    const query = { ...router.query } as Record<string, string>;
    if (target > 1) query[PANE_QUERY] = String(target);
    else delete query[PANE_QUERY];
    router.replace({ pathname: router.pathname, query }, undefined, {
      shallow: true,
      scroll: false,
    });
  };

  // A page emptied by deletes returns to the last page (20 §15.3).
  useEffect(() => {
    if (data && total > 0 && page > pages) setPage(pages);
  }, [data, total, page, pages]);

  const onSelect = (selectKeys: string[]) => {
    router.push(routeWith(Path.Thread, { id: selectKeys[0] }));
  };

  const onRename = async (id: string, newName: string) => {
    const result = await updateThread({
      variables: { where: { id: Number(id) }, data: { summary: newName } },
    });
    if (result?.data) notify.success(kailoT('list.renamed'));
    refetch();
  };

  const onDelete = async (id: string) => {
    const result = await deleteThread({
      variables: { where: { id: Number(id) } },
    });
    if (result?.data) notify.success(kailoT('list.threadDeleted'));
    refetch();
  };

  return {
    data: { threads },
    pane: {
      total,
      page: Math.min(page, pages),
      pages,
      loading: loading && !shown,
      refreshing: loading && !!shown,
      error: shown ? undefined : error,
      setPage,
      retry: () => refetch(),
      newThreadPath: routeWith(Path.Home, {}),
    },
    onSelect,
    onRename,
    onDelete,
    refetch,
  };
}
