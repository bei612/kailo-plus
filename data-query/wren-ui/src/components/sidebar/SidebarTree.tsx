import Link from 'next/link';
import { useState } from 'react';
import styled, { css } from 'styled-components';
import { Tree, TreeProps } from 'antd';

// DD-152 (20 §13 列表窗格): rows 32 high, 13/500, radius 6, 8 px inner
// padding and 8 px outer margin; hover = hover token, selected = brand-soft
// with brand-soft text; group titles are Overline 11/14 600 0.04em muted
// upper case; icons are single-colour line in muted (selected rows follow
// the row text).
const anticonStyle = css`
  [class^='anticon anticon-'] {
    transition: background-color var(--kailo-duration-instant)
      var(--kailo-ease-standard);
    border-radius: 4px;
    width: 12px;
    height: 12px;
    font-size: 12px;
    vertical-align: middle;

    &:hover {
      background-color: var(--kailo-color-hover);
    }
    &:active {
      background-color: var(--kailo-color-pressed);
    }

    &[disabled] {
      cursor: not-allowed;
      color: var(--kailo-color-text-disabled);
      &:hover,
      &:active {
        background-color: transparent;
      }
    }
  }
  .anticon + .anticon {
    margin-left: 4px;
  }
`;

const StyledTree = styled(Tree)`
  &.ant-tree {
    background-color: transparent;
    color: var(--kailo-color-foreground);
    font-size: 13px;
    font-weight: 500;

    .ant-tree-indent-unit {
      width: 12px;
    }

    .ant-tree-node-content-wrapper {
      display: flex;
      align-items: center;
      line-height: 18px;
      min-height: 32px;
      min-width: 1px;
      padding: 0;
    }

    .ant-tree-node-content-wrapper:hover,
    .ant-tree-node-content-wrapper.ant-tree-node-selected {
      background-color: transparent;
    }

    .ant-tree-iconEle,
    .ant-tree-switcher {
      color: var(--kailo-color-muted-foreground);
    }

    .ant-tree-treenode {
      margin: 0 8px;
      padding: 0 8px;
      border-radius: 6px;
      background-color: transparent;
      transition: background-color var(--kailo-duration-instant)
        var(--kailo-ease-standard);

      &-selected {
        color: var(--kailo-color-selected-foreground);
        background-color: var(--kailo-color-selected);

        .ant-tree-iconEle {
          color: inherit;
        }
      }

      .ant-tree-switcher {
        width: 12px;
        align-self: center;
        .ant-tree-switcher-icon {
          font-size: 12px;
          vertical-align: middle;
        }
        ${anticonStyle}
      }

      .ant-tree-iconEle {
        flex-shrink: 0;
      }
    }

    .adm {
      &-treeTitle__title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      &-treeNode {
        &:hover {
          background-color: var(--kailo-color-hover);
        }
        &:active {
          background-color: var(--kailo-color-pressed);
        }
        &.ant-tree-treenode-selected:hover {
          background-color: var(--kailo-color-selected-hover);
        }

        .ant-tree-title {
          display: inline-flex;
          flex-wrap: nowrap;
          min-width: 1px;
        }

        &--relation,
        &--primary {
          margin-left: 4px;
          color: var(--kailo-color-muted-foreground);
        }

        &--group {
          color: var(--kailo-color-muted-foreground);
          margin-top: 16px;

          font-size: 11px;
          line-height: 14px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;

          .ant-tree-switcher-noop {
            display: none;
          }

          > * {
            cursor: inherit;
          }
        }

        &--empty {
          color: var(--kailo-color-muted-foreground);
          font-size: 12px;
          font-weight: 400;
          .ant-tree-switcher {
            display: none;
          }
          .ant-tree-node-content-wrapper {
            min-height: auto;
          }
        }

        &--selectNode {
          * {
            cursor: auto;
          }
          &:hover,
          &:active {
            background-color: transparent;
          }
        }

        &--subtitle {
          color: var(--kailo-color-muted-foreground);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          .ant-tree-switcher {
            display: none;
          }
          .ant-tree-node-content-wrapper {
            min-height: auto;
          }
        }

        &--selectNone {
          * {
            cursor: auto;
          }
          &:hover,
          &:active {
            background-color: transparent;
          }
        }
      }

      &-actionIcon {
        font-size: 14px;
        border-radius: 4px;
        margin-right: -3px;
        color: var(--kailo-color-muted-foreground);
        &:not(.adm-actionIcon--disabled) {
          cursor: pointer;
          &:hover {
            background-color: var(--kailo-color-hover);
            color: var(--kailo-color-foreground);
          }
        }
        .anticon {
          padding: 2px;
          cursor: inherit;
        }
        &--disabled {
          color: var(--kailo-color-text-disabled);
          cursor: not-allowed;
        }
      }
    }
  }
`;

export const sidebarCommonStyle = css`
  .ant-tree-title {
    flex-grow: 1;
    display: inline-flex;
    align-items: center;
    span:first-child,
    .adm-treeTitle__title {
      flex-grow: 1;
    }
  }
`;

export const StyledTreeNodeLink = styled(Link)`
  display: flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
  margin: 8px 8px 0;
  padding: 0 8px;
  min-height: 32px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--kailo-color-foreground);
  .anticon,
  .kailo-icon {
    color: var(--kailo-color-muted-foreground);
  }
  &:hover {
    background-color: var(--kailo-color-hover);
    color: var(--kailo-color-foreground);
  }
  &:active {
    background-color: var(--kailo-color-pressed);
  }
  &.adm-treeNode--selected {
    background-color: var(--kailo-color-selected);
    color: var(--kailo-color-selected-foreground);
    .anticon,
    .kailo-icon {
      color: inherit;
    }
  }
`;

export const useSidebarTreeState = () => {
  const [treeSelectedKeys, setTreeSelectedKeys] = useState<React.Key[]>([]);
  const [treeExpandKeys, setTreeExpandKeys] = useState<React.Key[]>([]);
  const [treeLoadedKeys, setTreeLoadedKeys] = useState<React.Key[]>([]);
  const [autoExpandParent, setAutoExpandParent] = useState(true);

  return {
    treeSelectedKeys,
    treeExpandKeys,
    treeLoadedKeys,
    autoExpandParent,
    setTreeSelectedKeys,
    setTreeExpandKeys,
    setTreeLoadedKeys,
    setAutoExpandParent,
  };
};

export default function SidebarTree(props: TreeProps) {
  return (
    <StyledTree
      blockNode
      showIcon
      motion={null} // https://github.com/ant-design/ant-design/issues/16943#issuecomment-859966751
      {...props}
    />
  );
}
