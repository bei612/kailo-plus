import styled from 'styled-components';
import { Button } from 'antd';
import { DataNode } from 'antd/lib/tree';
import { getColumnTypeIcon } from '@/utils/columnType';
import { PrimaryKeyIcon, RelationshipIcon } from '@/utils/icons';
import { ComposeDiagramField } from '@/utils/data';
import { assign, isEmpty, snakeCase } from 'lodash';
import { kailoT } from '@/utils/kailoI18n';
import GroupTreeTitle, { ActionType } from './modeling/GroupTreeTitle';
import { getJoinTypeText } from '@/utils/data';
import { NODE_TYPE } from '@/utils/enum';
import { getNodeTypeIcon } from '@/utils/nodeType';

type TreeNode = DataNode;

const ColumnNode = ({ title, relation, primary }) => {
  const append = (
    <>
      {relation && (
        <span
          className="adm-treeNode--relation"
          title={`${relation.name}: ${getJoinTypeText(relation.joinType)}`}
        >
          <RelationshipIcon />
        </span>
      )}
      {primary && (
        <span
          className="adm-treeNode--primary"
          title={kailoT('modeling.primaryKey')}
        >
          <PrimaryKeyIcon />
        </span>
      )}
    </>
  );

  return (
    <>
      <span title={title}>{title}</span>
      {append}
    </>
  );
};

const getChildrenSubtitle = (nodeKey: string, title: string) => [
  {
    title,
    key: `${nodeKey}_${snakeCase(title)}`,
    className: 'adm-treeNode--subtitle adm-treeNode--selectNone',
    selectable: false,
    isLeaf: true,
  },
];

export const getColumnNode = (
  nodeKey: string,
  columns: ComposeDiagramField[],
  title?: string,
): TreeNode[] => {
  if (columns.length === 0) return [];

  return [
    ...(title ? getChildrenSubtitle(nodeKey, title) : []),
    ...columns.map((column): TreeNode => {
      // show the model icon for relation item
      const isRelation = column.nodeType === NODE_TYPE.RELATION;
      const icon = isRelation
        ? getNodeTypeIcon({ nodeType: NODE_TYPE.MODEL })
        : getColumnTypeIcon(column, { title: column.type });

      return {
        icon,
        className: 'adm-treeNode adm-treeNode-column adm-treeNode--selectNode',
        title: (
          <ColumnNode
            title={column.displayName}
            relation={isRelation ? column : null}
            primary={column?.isPrimaryKey}
          />
        ),
        key: column.id,
        selectable: false,
        isLeaf: true,
      };
    }),
  ];
};

interface GroupSet {
  groupName: string;
  groupKey: string;
  quotaUsage?: number;
  appendSlot?: React.ReactNode;
  children?: DataNode[];
  actions: ActionType[];
  /** Shown when the group has no items (e.g. 暂无视图). */
  emptyText?: string;
}

export const createTreeGroupNode =
  (sourceData: GroupSet) => (updatedData?: Partial<GroupSet>) => {
    const {
      groupName = '',
      groupKey = '',
      quotaUsage,
      actions,
      children = [],
      appendSlot,
      emptyText,
    } = assign(sourceData, updatedData);

    const emptyChildren = [
      {
        title: emptyText || kailoT('modeling.noItems'),
        key: `${groupKey}-empty`,
        selectable: false,
        className: 'adm-treeNode adm-treeNode--empty adm-treeNode--selectNode',
      },
    ];
    const childrenData = isEmpty(children) ? emptyChildren : children;

    return [
      {
        className: 'adm-treeNode--group',
        title: (
          <GroupTreeTitle
            title={groupName}
            quotaUsage={quotaUsage}
            appendSlot={appendSlot}
            actions={actions}
          />
        ),
        key: groupKey,
        selectable: false,
        isLeaf: true,
      },
      ...childrenData,
    ];
  };

// Small text/icon button in a group title (新建, 刷新): no upper case.
export const GroupActionButton = styled(Button)`
  font-size: var(--kailo-text-caption);
  font-weight: 500;
  letter-spacing: normal;
  text-transform: none;
  height: 24px;
  padding: 0 6px;
  border-radius: 6px;
  border-color: transparent;
  box-shadow: none;
  background: transparent;
  color: var(--kailo-color-muted-foreground);
  &:hover {
    background-color: var(--kailo-color-hover);
    border-color: transparent;
    color: var(--kailo-color-foreground);
  }
  &:focus {
    border-color: transparent;
    background: transparent;
    color: var(--kailo-color-foreground);
  }
`;
