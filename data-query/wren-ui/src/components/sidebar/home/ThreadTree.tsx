import { useState, useEffect } from 'react';
import styled from 'styled-components';
import { DataNode } from 'antd/lib/tree';
import { Path } from '@/utils/enum';
import { useParams, useRouter } from 'next/navigation';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import SidebarTree, {
  sidebarCommonStyle,
} from '@/components/sidebar/SidebarTree';
import {
  createTreeGroupNode,
  GroupActionButton,
} from '@/components/sidebar/utils';
import TreeTitle from './TreeTitle';
import useKailoText, { useKailoLocale } from '@/utils/kailoI18n';
import { KailoUserView } from '@/components/kailo/KailoUser';

// DD-157 (20 §2 列表窗格): rows 32 high, 13/500, radius 6, 8 inner padding,
// 8 outer margin; hover/selected roles; the group title is an Overline.
const StyledSidebarTree = styled(SidebarTree)`
  ${sidebarCommonStyle}

  &&.ant-tree .ant-tree-treenode.adm-treeNode--group {
    margin: 16px 8px 4px;
    padding: 0 8px;
    min-height: 24px;
    font-size: 11px;
    line-height: 14px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--kailo-color-muted-foreground);
    &:hover,
    &:active {
      background-color: transparent;
    }
  }

  &&.ant-tree .ant-tree-treenode.adm-treeNode__thread {
    margin: 0 8px;
    padding: 0 8px !important;
    min-height: 32px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    color: var(--kailo-color-foreground);
    transition: background-color var(--kailo-duration-instant);

    .ant-tree-node-content-wrapper {
      min-height: 32px;
    }
    &:hover {
      background-color: var(--kailo-color-hover);
    }
    &:active {
      background-color: var(--kailo-color-pressed);
    }
    &.ant-tree-treenode-selected {
      background-color: var(--kailo-color-selected);
      color: var(--kailo-color-selected-foreground);
    }
  }

  .adm-treeNode {
    &.adm-treeNode__thread {
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

export interface ThreadData {
  id: string;
  name: string;
  owner?: KailoUserView | null;
  canManage?: boolean;
}

interface Props {
  threads: ThreadData[];
  selectedKeys: React.Key[];
  onSelect: (selectKeys: React.Key[], info: any) => void;
  onRename: (id: string, newName: string) => Promise<void>;
  onDeleteThread: (id: string) => Promise<void>;
}

export default function ThreadTree(props: Props) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useKailoText();
  // The tree is cached in state: rebuild it when the page locale changes (the
  // embedded page switches its Next locale after the first render).
  const locale = useKailoLocale();
  const {
    threads = [],
    selectedKeys,
    onSelect,
    onRename,
    onDeleteThread,
  } = props;

  const getThreadGroupNode = createTreeGroupNode({
    groupName: t('threads'),
    groupKey: 'threads',
    actions: [
      {
        key: 'new-thread',
        render: () => (
          <GroupActionButton
            size="small"
            icon={<PlusOutlined />}
            onClick={() => router.push(Path.Home)}
          >
            {t('newThread')}
          </GroupActionButton>
        ),
      },
    ],
  });

  const [tree, setTree] = useState<DataNode[]>(getThreadGroupNode());

  useEffect(() => {
    setTree((_tree) =>
      getThreadGroupNode({
        quotaUsage: threads.length,
        children: threads.map((thread) => {
          const nodeKey = thread.id;

          return {
            className: 'adm-treeNode adm-treeNode__thread',
            id: nodeKey,
            isLeaf: true,
            key: nodeKey,
            title: (
              <TreeTitle
                id={nodeKey}
                title={thread.name}
                owner={thread.owner}
                canManage={thread.canManage}
                onRename={onRename}
                onDelete={onDeleteThread}
              />
            ),
          };
        }),
      }),
    );
  }, [params?.id, threads, locale]);

  return (
    <StyledSidebarTree
      treeData={tree}
      selectedKeys={selectedKeys}
      onSelect={onSelect}
    />
  );
}
