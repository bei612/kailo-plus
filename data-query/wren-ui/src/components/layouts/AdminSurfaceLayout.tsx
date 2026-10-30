import { Layout } from 'antd';
import styled from 'styled-components';
import Sidebar from '@/components/sidebar';
import PageLoading from '@/components/PageLoading';
import DataSourcePicker from '@/components/pages/dataSources/DataSourcePicker';

const { Sider, Content } = Layout;

// DD-138(6) (`20` §13.2 管理面页): the frame of an admin surface with a
// business list pane (the modeling model tree). Kailo draws the page header;
// there is no header, tab bar, settings entry or account menu here.
// 20 §13 list pane: 264 wide, surface, 1px line on the right edge.
const StyledSider = styled(Sider)`
  height: 100vh;
  overflow: auto;
  border-right: 1px solid var(--kailo-color-border);
`;

const StyledContent = styled(Content)`
  position: relative;
  height: 100vh;
  overflow: auto;
`;

interface Props {
  sidebar: React.ComponentProps<typeof Sidebar>;
  loading?: boolean;
  children: React.ReactNode;
}

export default function AdminSurfaceLayout(props: Props) {
  const { sidebar, loading, children } = props;
  return (
    <Layout className="adm-layout">
      <StyledSider width={264}>
        {/* DD-169(6)①: modeling acts on the selected data source. */}
        <div className="px-4 pt-4">
          <DataSourcePicker />
        </div>
        <Sidebar {...sidebar} />
      </StyledSider>
      <StyledContent>{children}</StyledContent>
      <PageLoading visible={!!loading} />
    </Layout>
  );
}
