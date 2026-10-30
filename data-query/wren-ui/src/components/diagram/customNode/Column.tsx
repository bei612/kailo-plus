import React from 'react';
import styled from 'styled-components';
import MarkerHandle from '@/components/diagram/customNode/MarkerHandle';
import useKailoText from '@/utils/kailoI18n';

const NodeColumn = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  color: var(--kailo-color-foreground);
  font-size: var(--kailo-text-callout);
  line-height: 24px;

  &:hover {
    background-color: var(--kailo-color-hover);
  }

  svg {
    flex-shrink: 0;
  }

  .kailo-node-action {
    color: var(--kailo-color-muted-foreground);
  }

  .adm-column-title {
    display: flex;
    align-items: center;
    min-width: 1px;
    svg {
      margin-right: 6px;
      color: var(--kailo-color-muted-foreground);
    }
    > span {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
`;

// Section label: Overline 11/14 600 0.04em, muted.
const Title = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 28px;
  color: var(--kailo-color-muted-foreground);
  font-size: var(--kailo-text-overline);
  line-height: 14px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 6px 8px 2px;
  cursor: default;

  .kailo-node-action {
    color: var(--kailo-color-muted-foreground);
  }
`;

type ColumnProps = {
  id: number | string;
  type: string;
  displayName: string;
  style?: React.CSSProperties;
  icon: React.ReactNode;
  extra?: React.ReactNode;
  onMouseEnter?: (event: React.MouseEvent) => void;
  onMouseLeave?: (event: React.MouseEvent) => void;
};

type ColumnTitleProps = {
  show: boolean;
  extra?: React.ReactNode;
  children: React.ReactNode;
};

export default function Column(props: ColumnProps) {
  const {
    id,
    type,
    onMouseEnter,
    onMouseLeave,
    displayName,
    style = {},
    icon,
    extra,
  } = props;

  const nodeColumn = (
    <NodeColumn
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="adm-column-title">
        <span className="d-inline-flex flex-shrink-0" title={type}>
          {icon}
        </span>
        <span title={displayName}>{displayName}</span>
      </div>
      {extra}
      <MarkerHandle id={id.toString()} />
    </NodeColumn>
  );

  return nodeColumn;
}

const MoreColumnTip = (props: { count: number }) => {
  const t = useKailoText();
  return (
    <div
      className="text-sm px-2 py-1"
      style={{ color: 'var(--kailo-color-muted-foreground)' }}
    >
      {t('modeling.moreColumns', { count: props.count })}
    </div>
  );
};

const ColumnTitle = (props: ColumnTitleProps) => {
  const { show, extra, children } = props;
  if (!show) return null;

  return (
    <Title>
      {children}
      <span>{extra}</span>
    </Title>
  );
};

Column.Title = ColumnTitle;
Column.MoreTip = MoreColumnTip;
