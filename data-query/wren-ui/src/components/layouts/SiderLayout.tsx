import { Layout } from 'antd';
import styled, { css } from 'styled-components';
import SimpleLayout from '@/components/layouts/SimpleLayout';
import Sidebar from '@/components/sidebar';
import useKailoSession from '@/hooks/useKailoSession';

const { Sider } = Layout;

// DD-157: inside Kailo there is no header of our own (Kailo renders it), so
// the panes take the full frame height and only the content area scrolls.
const basicStyle = css<{ $hostPage?: boolean }>`
  height: ${(props) =>
    props.$hostPage ? 'var(--kailo-vh)' : 'calc(var(--kailo-vh) - 48px)'};
  overflow: auto;
`;

const StyledContentLayout = styled(Layout)<{
  color?: string;
  $hostPage?: boolean;
}>`
  position: relative;
  ${basicStyle}
  ${(props) => props.color && `background-color: var(--${props.color});`}
`;

// 20 §13 list pane: 264 wide, surface, 1px line on the right edge.
const StyledSider = styled(Sider)<{ $hostPage?: boolean }>`
  ${basicStyle}
  border-right: 1px solid var(--kailo-color-border);
`;

type Props = React.ComponentProps<typeof SimpleLayout> & {
  sidebar?: React.ComponentProps<typeof Sidebar>;
  color?: string;
};

export default function SiderLayout(props: Props) {
  const { sidebar, loading, color } = props;
  // DD-138(6): no settings dialog on business pages; data source and project
  // settings are Kailo admin surfaces.
  const { hostPage } = useKailoSession();

  return (
    <SimpleLayout loading={loading}>
      <Layout className="adm-layout">
        <StyledSider width={264} $hostPage={hostPage}>
          <Sidebar {...sidebar} />
        </StyledSider>
        <StyledContentLayout color={color} $hostPage={hostPage}>
          {props.children}
        </StyledContentLayout>
      </Layout>
    </SimpleLayout>
  );
}
