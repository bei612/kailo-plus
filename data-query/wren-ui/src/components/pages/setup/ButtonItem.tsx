import Image from 'next/image';
import { Button } from 'antd';
import styled from 'styled-components';
import Icon from '@/import/icon';
import { IterableComponent } from '@/utils/iteration';
import { ButtonOption } from './utils';
import { SampleDatasetName } from '@/apollo/client/graphql/__types__';
import useKailoText from '@/utils/kailoI18n';

// DD-152 (20 §3 卡片): selectable card — surface, 1px line, radius 12;
// hover lifts with shadow-sm, selected uses the brand line.
const StyledButton = styled(Button)`
  border: 1px var(--kailo-color-border) solid;
  background-color: var(--kailo-color-background);
  color: var(--kailo-color-foreground);
  border-radius: 12px;
  width: 100%;
  height: auto;
  box-shadow: none;

  &:focus {
    border: 1px var(--kailo-color-border) solid;
    background-color: var(--kailo-color-background);
    color: var(--kailo-color-foreground);
  }

  &:hover {
    border-color: var(--kailo-color-brand);
    background-color: var(--kailo-color-background);
    color: var(--kailo-color-foreground);
    box-shadow: var(--kailo-shadow-sm);
  }

  &.is-active {
    border-color: var(--kailo-color-brand) !important;
    background-color: var(--kailo-color-selected) !important;
  }

  &:disabled {
    opacity: 0.5;
  }

  // loading of button
  .ant-btn-loading-icon .anticon {
    font-size: 24px;
  }
`;

const StyledIcon = styled(Icon)`
  width: 40px;
  height: 40px;
  font-size: 32px;
  display: inline-flex;
  justify-content: center;
  align-items: center;
`;

const PlainImage = styled.div`
  border: 1px var(--kailo-color-border) solid;
  border-radius: 8px;
  background-color: var(--kailo-color-muted);
  width: 40px;
  height: 40px;
`;

const ComingSoon = styled.div`
  background: var(--kailo-color-muted);
  color: var(--kailo-color-muted-foreground);
  font-size: 12px;
  font-weight: 500;
  line-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  white-space: nowrap;
`;

type Props = ButtonOption & {
  selectedTemplate: SampleDatasetName;
  onSelect: (value: string) => void;
};

export default function ButtonItem(props: IterableComponent<Props>) {
  const {
    value,
    disabled,
    submitting,
    logo,
    IconComponent,
    label,
    onSelect,
    selectedTemplate,
  } = props;

  const t = useKailoText();
  const isSelected = selectedTemplate === value;
  const loading = isSelected && submitting;

  return (
    <StyledButton
      className={[
        'px-4 py-2 d-flex align-center',
        loading ? 'flex-start' : 'justify-space-between',
        isSelected ? 'is-active' : '',
      ].join(' ')}
      disabled={disabled || submitting}
      loading={loading}
      onClick={() => onSelect(value)}
    >
      <div className="d-flex align-center" style={{ width: '100%' }}>
        {logo ? (
          <Image
            className="mr-2"
            src={logo}
            alt={label}
            width="40"
            height="40"
          />
        ) : IconComponent ? (
          <StyledIcon component={IconComponent} className="mr-2" />
        ) : (
          <PlainImage className="mr-2" />
        )}
        {label}
      </div>
      {disabled && <ComingSoon>{t('setup.comingSoon')}</ComingSoon>}
    </StyledButton>
  );
}
