import React from 'react';
import styled from 'styled-components';
import { Dropdown, Menu } from 'antd';
import { ItemType } from 'antd/lib/menu/hooks/useItems';
import { MORE_ACTION, NODE_TYPE } from '@/utils/enum';
import { kailoT } from '@/utils/kailoI18n';
import {
  CodeIcon,
  ColumnsIcon,
  DatabaseIcon,
  EyeIcon,
  EyeOffIcon,
  ListChecksIcon,
  PencilIcon,
  RefreshIcon,
} from '@/components/kailo/KailoIcons';
import {
  DeleteCalculatedFieldModal,
  DeleteRelationshipModal,
  DeleteModelModal,
  DeleteViewModal,
  DeleteDashboardItemModal,
  DeleteQuestionSQLPairModal,
  DeleteInstructionModal,
} from '@/components/modals/DeleteModal';

// DD-152 (20 §13 菜单): Kailo menu — line icons in muted, text in the
// foreground colour, the destructive item last (danger text via `danger`).
// The surface, radius, padding and row height come from the Kailo overlay.
const StyledMenu = styled(Menu)`
  .ant-dropdown-menu-item:not(.ant-dropdown-menu-item-disabled):not(
      .ant-dropdown-menu-item-danger
    ) {
    color: var(--kailo-color-foreground);
  }

  .kailo-icon {
    color: var(--kailo-color-muted-foreground);
  }

  .ant-dropdown-menu-item-danger .kailo-icon,
  .ant-dropdown-menu-item-danger a {
    color: var(--kailo-color-danger-text);
  }
`;

interface Props {
  [key: string]: any;
  onMoreClick: (type: MORE_ACTION | { type: MORE_ACTION; data: any }) => void;
  onMenuEnter?: (event: React.MouseEvent) => void;
  children: React.ReactNode;
  onDropdownVisibleChange?: (visible: boolean) => void;
}

const makeDropdown =
  (getItems: (props: Props) => ItemType[]) => (props: Props) => {
    const { children, onMenuEnter, onDropdownVisibleChange } = props;

    const items = getItems(props);

    return (
      <Dropdown
        trigger={['click']}
        overlayStyle={{ minWidth: 160, userSelect: 'none' }}
        overlay={
          <StyledMenu
            onClick={(e) => e.domEvent.stopPropagation()}
            items={items}
            onMouseEnter={onMenuEnter}
          />
        }
        onVisibleChange={onDropdownVisibleChange}
      >
        {children}
      </Dropdown>
    );
  };

const withIcon = (Icon: React.ComponentType<any>, text: string) => (
  <>
    <Icon className="mr-2" />
    {text}
  </>
);

const deleteItem = (label: React.ReactNode): ItemType => ({
  label,
  danger: true,
  key: MORE_ACTION.DELETE,
  onClick: ({ domEvent }) => domEvent.stopPropagation(),
});

export const ModelDropdown = makeDropdown((props: Props) => {
  const { onMoreClick } = props;

  const items: ItemType[] = [
    {
      label: withIcon(ColumnsIcon, kailoT('modeling.updateColumns')),
      key: MORE_ACTION.UPDATE_COLUMNS,
      onClick: () => onMoreClick(MORE_ACTION.UPDATE_COLUMNS),
    },
    { type: 'divider' },
    deleteItem(
      <DeleteModelModal onConfirm={() => onMoreClick(MORE_ACTION.DELETE)} />,
    ),
  ];

  return items;
});

export const ViewDropdown = makeDropdown((props: Props) => {
  const { onMoreClick } = props;
  const items: ItemType[] = [
    deleteItem(
      <DeleteViewModal onConfirm={() => onMoreClick(MORE_ACTION.DELETE)} />,
    ),
  ];
  return items;
});

export const ColumnDropdown = makeDropdown((props: Props) => {
  const { onMoreClick, data } = props;
  const { nodeType } = data;

  const DeleteColumnModal =
    {
      [NODE_TYPE.CALCULATED_FIELD]: DeleteCalculatedFieldModal,
      [NODE_TYPE.RELATION]: DeleteRelationshipModal,
    }[nodeType] || DeleteCalculatedFieldModal;

  const items: ItemType[] = [
    {
      label: withIcon(PencilIcon, kailoT('modeling.edit')),
      key: MORE_ACTION.EDIT,
      onClick: () => onMoreClick(MORE_ACTION.EDIT),
    },
    { type: 'divider' },
    deleteItem(
      <DeleteColumnModal onConfirm={() => onMoreClick(MORE_ACTION.DELETE)} />,
    ),
  ];

  return items;
});

export const DashboardDropdown = makeDropdown((props: Props) => {
  const { onMoreClick, isSupportCached } = props;
  const items: ItemType[] = [
    isSupportCached && {
      label: withIcon(DatabaseIcon, kailoT('modeling.cacheSettings')),
      key: MORE_ACTION.CACHE_SETTINGS,
      onClick: () => onMoreClick(MORE_ACTION.CACHE_SETTINGS),
    },
    {
      label: withIcon(
        RefreshIcon,
        isSupportCached
          ? kailoT('modeling.refreshAllCaches')
          : kailoT('modeling.refreshAll'),
      ),
      key: MORE_ACTION.REFRESH,
      onClick: () => onMoreClick(MORE_ACTION.REFRESH),
    },
  ].filter(Boolean);
  return items;
});

export const DashboardItemDropdown = makeDropdown((props: Props) => {
  const { onMoreClick, isHideLegend, isSupportCached } = props;
  const items: ItemType[] = [
    {
      label: isHideLegend
        ? withIcon(EyeIcon, kailoT('modeling.showCategories'))
        : withIcon(EyeOffIcon, kailoT('modeling.hideCategories')),
      key: MORE_ACTION.HIDE_CATEGORY,
      onClick: () => onMoreClick(MORE_ACTION.HIDE_CATEGORY),
    },
    {
      label: withIcon(
        RefreshIcon,
        isSupportCached
          ? kailoT('modeling.refreshCache')
          : kailoT('modeling.refresh'),
      ),
      key: MORE_ACTION.REFRESH,
      onClick: () => onMoreClick(MORE_ACTION.REFRESH),
    },
    { type: 'divider' },
    deleteItem(
      <DeleteDashboardItemModal
        onConfirm={() => onMoreClick(MORE_ACTION.DELETE)}
      />,
    ),
  ];
  return items;
});

export const SQLPairDropdown = makeDropdown(
  (
    props: Props & {
      onMoreClick: (payload: { type: MORE_ACTION; data: any }) => void;
    },
  ) => {
    const { onMoreClick, data } = props;
    const items: ItemType[] = [
      {
        label: withIcon(EyeIcon, kailoT('modeling.view')),
        key: MORE_ACTION.VIEW_SQL_PAIR,
        onClick: () =>
          onMoreClick({
            type: MORE_ACTION.VIEW_SQL_PAIR,
            data,
          }),
      },
      {
        label: withIcon(PencilIcon, kailoT('modeling.edit')),
        key: MORE_ACTION.EDIT,
        onClick: () =>
          onMoreClick({
            type: MORE_ACTION.EDIT,
            data,
          }),
      },
      { type: 'divider' },
      deleteItem(
        <DeleteQuestionSQLPairModal
          onConfirm={() =>
            onMoreClick({
              type: MORE_ACTION.DELETE,
              data,
            })
          }
        />,
      ),
    ];
    return items;
  },
);

export const InstructionDropdown = makeDropdown(
  (
    props: Props & {
      onMoreClick: (payload: { type: MORE_ACTION; data: any }) => void;
    },
  ) => {
    const { onMoreClick, data } = props;
    const items: ItemType[] = [
      {
        label: withIcon(EyeIcon, kailoT('modeling.view')),
        key: MORE_ACTION.VIEW_INSTRUCTION,
        onClick: () =>
          onMoreClick({
            type: MORE_ACTION.VIEW_INSTRUCTION,
            data,
          }),
      },
      {
        label: withIcon(PencilIcon, kailoT('modeling.edit')),
        key: MORE_ACTION.EDIT,
        onClick: () =>
          onMoreClick({
            type: MORE_ACTION.EDIT,
            data,
          }),
      },
      { type: 'divider' },
      deleteItem(
        <DeleteInstructionModal
          onConfirm={() =>
            onMoreClick({
              type: MORE_ACTION.DELETE,
              data,
            })
          }
        />,
      ),
    ];
    return items;
  },
);

export const AdjustAnswerDropdown = makeDropdown(
  (
    props: Props & {
      onMoreClick: (payload: { type: MORE_ACTION; data: any }) => void;
    },
  ) => {
    const { onMoreClick, data } = props;
    const items: ItemType[] = [
      {
        label: kailoT('modeling.adjustSteps'),
        icon: <ListChecksIcon />,
        disabled: !data.sqlGenerationReasoning,
        key: 'adjust-steps',
        onClick: () =>
          onMoreClick({
            type: MORE_ACTION.ADJUST_STEPS,
            data,
          }),
      },
      {
        label: kailoT('modeling.adjustSql'),
        icon: <CodeIcon />,
        disabled: !data.sql,
        key: 'adjust-sql',
        onClick: () =>
          onMoreClick({
            type: MORE_ACTION.ADJUST_SQL,
            data,
          }),
      },
    ];
    return items;
  },
);
