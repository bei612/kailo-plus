import { useEffect } from 'react';
import { Layout } from 'antd';
import styled, { css } from 'styled-components';
import SimpleLayout from '@/components/layouts/SimpleLayout';
import Sidebar from '@/components/sidebar';
import Settings from '@/components/settings';
import useModalAction from '@/hooks/useModalAction';
import useKailoSession from '@/hooks/useKailoSession';
import * as events from '@/utils/events';

const { Sider } = Layout;

// DD-152: inside Kailo there is no header of our own (Kailo renders it), so
// the panes take the full frame height and only the content area scrolls.
const basicStyle = css<{ $hostPage?: boolean }>`
  height: ${(props) => (props.$hostPage ? '100vh' : 'calc(100vh - 48px)')};
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
  const settings = useModalAction();
  const { hostPage, isAdmin } = useKailoSession();

  // "数据源设置" (Kailo header menu or the top-level header), admins only.
  useEffect(() => {
    const open = () => isAdmin && settings.openModal();
    events.subscribe(events.EVENT_NAME.OPEN_SETTINGS, open);
    return () => events.unsubscribe(events.EVENT_NAME.OPEN_SETTINGS, open);
  }, [isAdmin]);

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
      <Settings {...settings.state} onClose={settings.closeModal} />
    </SimpleLayout>
  );
}
