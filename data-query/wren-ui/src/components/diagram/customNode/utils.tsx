import { CachedProps } from '@/utils/data';
import { LightningIcon } from '@/utils/icons';
import { Tooltip } from 'antd';
import { kailoT } from '@/utils/kailoI18n';
import { NodeProps } from 'reactflow';
import styled from 'styled-components';

export type CustomNodeProps<T> = NodeProps<{
  originalData: T;
  index: number;
  highlight: string[];
}>;

// DD-157 (20 §13 卡片): canvas cards are Kailo cards — card surface, 1px
// line, radius 12, no resting shadow; a brand header strip with on-brand
// text. All colours are tokens so the dark theme has no white cards.
export const StyledNode = styled.div`
  position: relative;
  width: 200px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--kailo-color-border);
  background-color: var(--kailo-color-card);
  color: var(--kailo-color-card-foreground);
  cursor: pointer;
  transition: box-shadow var(--kailo-duration-fast) var(--kailo-ease-standard);

  &:before {
    content: '';
    pointer-events: none;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1;
    border-radius: 12px;
    border: 2px solid transparent;
    transition: border-color var(--kailo-duration-fast)
      var(--kailo-ease-standard);
  }

  &:hover,
  &:focus {
    box-shadow: var(--kailo-shadow-sm);
    &:before {
      border-color: var(--kailo-color-brand);
    }
  }

  .react-flow__handle {
    border: none;
    opacity: 0;

    &-left {
      left: 0;
    }

    &-right {
      right: 0;
    }
  }
`;

export const NodeHeader = styled.div`
  position: relative;
  background-color: ${(props) => props.color || 'var(--kailo-color-brand)'};
  font-size: var(--kailo-text-callout);
  font-weight: 500;
  color: var(--kailo-color-on-brand);
  padding: 6px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;

  &.dragHandle {
    cursor: move;
  }

  .adm-model-header {
    display: flex;
    align-items: center;

    svg {
      margin-right: 6px;
    }
    + svg {
      cursor: pointer;
    }

    .ant-typography {
      width: 140px;
      color: var(--kailo-color-on-brand);
    }
  }

  .ant-btn,
  .ant-btn:hover,
  .ant-btn:focus {
    color: var(--kailo-color-on-brand);
  }
`;

export const NodeBody = styled.div`
  background-color: var(--kailo-color-card);
  color: var(--kailo-color-card-foreground);
  padding-bottom: 4px;
`;

export const CachedIcon = ({ originalData }: { originalData: CachedProps }) => {
  return originalData.cached ? (
    <Tooltip
      title={
        originalData.refreshTime
          ? kailoT('modeling.cachedEvery', { time: originalData.refreshTime })
          : kailoT('modeling.cached')
      }
      placement="top"
    >
      <LightningIcon className="cursor-pointer" />
    </Tooltip>
  ) : null;
};
