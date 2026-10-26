import { useRouter } from 'next/router';
import styled from 'styled-components';
import { Path } from '@/utils/enum';
import Home, { Props as HomeSidebarProps } from './Home';
import Modeling, { Props as ModelingSidebarProps } from './Modeling';
import Knowledge from './Knowledge';
import APIManagement from './APIManagement';

const Layout = styled.div`
  position: relative;
  height: 100%;
  background-color: var(--kailo-color-background);
  color: var(--kailo-color-foreground);
  padding-bottom: 8px;
  overflow-x: hidden;
`;

const Content = styled.div`
  flex-grow: 1;
  overflow-y: auto;
`;

type Props = ModelingSidebarProps | HomeSidebarProps;

const DynamicSidebar = (
  props: Props & {
    pathname: string;
  },
) => {
  const { pathname, ...restProps } = props;

  const getContent = () => {
    if (pathname.startsWith(Path.Home)) {
      return <Home {...(restProps as HomeSidebarProps)} />;
    }

    if (pathname.startsWith(Path.Modeling)) {
      return <Modeling {...(restProps as ModelingSidebarProps)} />;
    }

    if (pathname.startsWith(Path.Knowledge)) {
      return <Knowledge />;
    }

    if (pathname.startsWith(Path.APIManagement)) {
      return <APIManagement />;
    }

    return null;
  };

  return <Content>{getContent()}</Content>;
};

// DD-157 (20 §13 list pane) / DD-138(6): the pane holds only the
// section's business list; 数据源设置 is a page header menu entry for
// administrators, not a pane footer.
export default function Sidebar(props: Props) {
  const router = useRouter();
  return (
    <Layout className="d-flex flex-column">
      <DynamicSidebar {...props} pathname={router.pathname} />
    </Layout>
  );
}
