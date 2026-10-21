import { useMemo } from 'react';
import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';
import {
  useDeleteThreadMutation,
  useThreadsQuery,
  useUpdateThreadMutation,
} from '@/apollo/client/graphql/home.generated';
import useKailoSession from '@/hooks/useKailoSession';
import useGlobalConfig from '@/hooks/useGlobalConfig';

export default function useHomeSidebar() {
  const router = useRouter();
  const { isAdmin } = useKailoSession();
  const { config } = useGlobalConfig();
  const { data, refetch } = useThreadsQuery({
    fetchPolicy: 'cache-and-network',
  });
  const [updateThread] = useUpdateThreadMutation({
    onError: (error) => console.error(error),
  });
  const [deleteThread] = useDeleteThreadMutation({
    onError: (error) => console.error(error),
  });

  const threads = useMemo(
    () =>
      (data?.threads || []).map((thread) => ({
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
    [data, isAdmin, config],
  );

  const onSelect = (selectKeys: string[]) => {
    router.push(`${Path.Home}/${selectKeys[0]}`);
  };

  const onRename = async (id: string, newName: string) => {
    await updateThread({
      variables: { where: { id: Number(id) }, data: { summary: newName } },
    });
    refetch();
  };

  const onDelete = async (id) => {
    await deleteThread({ variables: { where: { id: Number(id) } } });
    refetch();
  };

  return {
    data: { threads },
    onSelect,
    onRename,
    onDelete,
    refetch,
  };
}
