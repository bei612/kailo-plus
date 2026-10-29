import { Spin } from 'antd';
import styled, { keyframes } from 'styled-components';
import useKailoText from '@/utils/kailoI18n';

// DD-157 (20 §13 加载): pages load behind a low-contrast skeleton (list pane
// rows and content blocks, 1.6s linear band) on the Kailo surface — never a
// white full-screen veil with a large spinner; local waits use a 14–16px
// ring in the brand colour.

const spin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const band = keyframes`
  from {
    background-position: 100% 50%;
  }
  to {
    background-position: 0 50%;
  }
`;

const Ring = styled.span<{ $size: number }>`
  display: inline-block;
  flex: none;
  width: ${(props) => props.$size}px;
  height: ${(props) => props.$size}px;
  border-radius: 50%;
  border: 2px solid
    color-mix(in srgb, var(--kailo-color-brand) 20%, transparent);
  border-top-color: var(--kailo-color-brand);
  animation: ${spin} 0.8s linear infinite;
  vertical-align: middle;
`;

const Wrapper = styled.div`
  position: absolute;
  top: 48px;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  background-color: var(--kailo-color-background);
  display: none;

  &.isShow {
    display: flex;
  }

  :root[data-kailo-embedded] & {
    top: 0;
  }
`;

const Bone = styled.div<{ $w?: string; $h?: number }>`
  width: ${(props) => props.$w || '100%'};
  height: ${(props) => props.$h || 12}px;
  border-radius: var(--kailo-radius-md);
  background: linear-gradient(
    90deg,
    var(--kailo-color-muted) 25%,
    var(--kailo-color-hover) 37%,
    var(--kailo-color-muted) 63%
  );
  background-size: 400% 100%;
  animation: ${band} 1.6s linear infinite;
`;

const Pane = styled.div`
  width: 264px;
  flex: none;
  padding: 16px 8px;
  border-right: 1px solid var(--kailo-color-border);
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const Main = styled.div`
  flex: 1;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

interface Props {
  visible?: boolean;
}

interface LoadingProps {
  children?: React.ReactNode | null;
  spinning?: boolean;
  loading?: boolean;
  tip?: string;
  size?: number;
  width?: number;
  height?: number;
  className?: string;
}

export const defaultIndicator = <Ring $size={16} />;

export const Spinner = ({
  className = '',
  size = 16,
}: {
  className?: string;
  size?: number;
}) => <Ring className={className} $size={Math.min(size, 16)} />;

export default function PageLoading(props: Props) {
  const { visible } = props;
  const t = useKailoText();
  return (
    <Wrapper
      className={visible ? 'isShow' : ''}
      role="status"
      aria-busy={visible}
      aria-label={t('loading')}
    >
      <Pane>
        <Bone $w="40%" $h={11} />
        {[72, 64, 80, 56, 68].map((width) => (
          <Bone key={width} $w={`${width}%`} $h={14} />
        ))}
      </Pane>
      <Main>
        <Bone $w="30%" $h={17} />
        <Bone $w="70%" />
        <Bone $w="60%" />
        <Bone $h={160} />
      </Main>
    </Wrapper>
  );
}

export const FlexLoading = (props) => {
  const { height, tip } = props;
  return (
    <div
      className="d-flex align-center justify-center flex-column gray-7"
      style={{ height: height || '100%', gap: 8 }}
    >
      {defaultIndicator}
      {tip && <span className="text-sm">{tip}</span>}
    </div>
  );
};

export const Loading = ({
  children = null,
  spinning = false,
  loading = false,
  tip,
}: LoadingProps) => (
  <Spin indicator={defaultIndicator} spinning={spinning || loading} tip={tip}>
    {children}
  </Spin>
);

interface LoadingWrapperProps {
  loading: boolean;
  tip?: string;
  children: React.ReactElement;
}

export const LoadingWrapper = (props: LoadingWrapperProps) => {
  const { loading, tip, children } = props;
  if (loading) return <FlexLoading tip={tip} />;
  return children;
};
