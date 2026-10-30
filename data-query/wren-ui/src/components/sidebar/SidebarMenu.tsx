import React from 'react';
import styled from 'styled-components';
import { Menu, MenuProps } from 'antd';

// DD-157 (20 §13 列表窗格): the same rows as the list pane tree — 32 high,
// 13/500, radius 6, 8 px padding and margin; hover / brand-soft selected;
// group titles as Overline; line icons in muted.
const StyledMenu = styled(Menu)`
  &.ant-menu {
    background-color: transparent;
    border-right: 0;
    color: var(--kailo-color-foreground);

    &:not(.ant-menu-horizontal) {
      .ant-menu-item-selected {
        color: var(--kailo-color-selected-foreground);
        background-color: var(--kailo-color-selected);
      }
    }

    .ant-menu-item-group {
      margin-top: 16px;

      &:first-child {
        margin-top: 0;
      }
    }

    .ant-menu-item-group-title {
      font-size: var(--kailo-text-overline);
      line-height: 14px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--kailo-color-muted-foreground);
      padding: 8px 16px 4px;
    }

    .ant-menu-item {
      display: flex;
      align-items: center;
      line-height: 32px;
      height: 32px;
      width: auto;
      margin: 0 8px;
      padding-left: 8px !important;
      padding-right: 8px;
      border-radius: 6px;
      font-size: var(--kailo-text-callout);
      font-weight: 500;

      &:not(last-child) {
        margin-bottom: 0;
      }

      .ant-menu-item-icon,
      .anticon,
      .kailo-icon,
      svg {
        color: var(--kailo-color-muted-foreground);
      }

      &:not(.ant-menu-item-disabled):hover {
        color: var(--kailo-color-foreground);
        background-color: var(--kailo-color-hover);
      }

      &:not(.ant-menu-item-disabled):active {
        background-color: var(--kailo-color-pressed);
      }

      &-selected {
        color: var(--kailo-color-selected-foreground);

        .ant-menu-item-icon,
        .anticon,
        .kailo-icon,
        svg {
          color: inherit;
        }

        &:after {
          display: none;
        }

        &:hover {
          color: var(--kailo-color-selected-foreground);
        }

        &:not(.ant-menu-item-disabled):hover {
          color: var(--kailo-color-selected-foreground);
          background-color: var(--kailo-color-selected-hover);
        }
      }
    }
  }
`;

export default function SidebarMenu({
  items,
  selectedKeys,
  onSelect,
}: MenuProps) {
  return (
    <StyledMenu
      mode="inline"
      items={items}
      selectedKeys={selectedKeys}
      onSelect={onSelect}
    />
  );
}
