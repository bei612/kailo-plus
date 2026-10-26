import clsx from 'clsx';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useParams } from 'next/navigation';
import styled from 'styled-components';
import { Path } from '@/utils/enum';
import { DashboardIcon } from '@/components/kailo/KailoIcons';
import SidebarTree, {
  StyledTreeNodeLink,
  useSidebarTreeState,
} from './SidebarTree';
import ThreadTree, { ThreadData } from './home/ThreadTree';
import useKailoText from '@/utils/kailoI18n';

export interface Props {
  data: {
    threads: ThreadData[];
  };
  onSelect: (selectKeys) => void;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, newName: string) => Promise<void>;
}

// DD-157 (20 §2 列表窗格): the 看板 entry is a pane row like the threads.
const DashboardLink = styled(StyledTreeNodeLink)`
  && {
    display: flex;
    align-items: center;
    margin: 8px 8px 0;
    padding: 0 8px;
    height: 32px;
    line-height: 32px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    color: var(--kailo-color-foreground);
    transition: background-color var(--kailo-duration-instant);
  }
  &&:hover {
    background-color: var(--kailo-color-hover);
  }
  &&:active {
    background-color: var(--kailo-color-pressed);
  }
  &&.adm-treeNode--selected {
    background-color: var(--kailo-color-selected);
    color: var(--kailo-color-selected-foreground);
  }
  .kailo-icon {
    color: var(--kailo-color-muted-foreground);
  }
  &&.adm-treeNode--selected .kailo-icon {
    color: inherit;
  }
`;

export const StyledSidebarTree = styled(SidebarTree)`
  .adm-treeNode {
    &.adm-treeNode__thread {
      padding: 0px 16px 0px 4px !important;

      .ant-tree-title {
        flex-grow: 1;
        display: inline-flex;
        align-items: center;
        span:first-child,
        .adm-treeTitle__title {
          flex-grow: 1;
        }
      }
    }
  }
`;

export default function Home(props: Props) {
  const { data, onSelect, onRename, onDelete } = props;
  const router = useRouter();
  const t = useKailoText();
  const params = useParams<{ id: string }>();
  const { threads } = data;

  const { treeSelectedKeys, setTreeSelectedKeys } = useSidebarTreeState();

  useEffect(() => {
    params?.id && setTreeSelectedKeys([params.id] as string[]);
  }, [params?.id]);

  const onDeleteThread = async (threadId: string) => {
    try {
      await onDelete(threadId);
      if (params?.id == threadId) {
        router.push(Path.Home);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const onTreeSelect = (selectedKeys: React.Key[], _info: any) => {
    // prevent deselected
    if (selectedKeys.length === 0) return;

    setTreeSelectedKeys(selectedKeys);
    onSelect(selectedKeys);
  };

  return (
    <>
      <DashboardLink
        className={clsx({
          'adm-treeNode--selected': router.pathname === Path.HomeDashboard,
        })}
        href={Path.HomeDashboard}
      >
        <DashboardIcon className="mr-2" />
        <span>{t('dashboard')}</span>
      </DashboardLink>
      <ThreadTree
        threads={threads}
        selectedKeys={treeSelectedKeys}
        onSelect={onTreeSelect}
        onRename={onRename}
        onDeleteThread={onDeleteThread}
      />
    </>
  );
}
