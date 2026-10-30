import { useRouter } from 'next/router';
import { nextQuery, readPaging, readText } from '@/utils/kailoList';

type Query = Record<string, string | string[] | undefined>;

/**
 * DD-167 (`20` §15.3 状态保存): page, page size, search and filters of a
 * list live in the route query, so back/forward and deep links show the
 * same view. Updates replace the entry shallowly (no data reload of the
 * page itself, no scroll jump); any filter change returns to page 1.
 */
export default function useListRoute(options: { size?: number } = {}) {
  const router = useRouter();
  const query = (router?.query || {}) as Query;
  const { page, size } = readPaging(query, { size: options.size });

  const update = (
    change: Record<string, string | number | undefined | null>,
  ) => {
    router.replace(
      {
        pathname: router.pathname,
        query: nextQuery(query, change, { size: options.size }),
      },
      undefined,
      { shallow: true, scroll: false },
    );
  };

  return {
    ready: router.isReady,
    page,
    size,
    text: (key: string) => readText(query, key),
    update,
    setPage: (next: number, nextSize = size) =>
      update(nextSize !== size ? { size: nextSize } : { page: next }),
  };
}
