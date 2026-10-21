import Link from 'next/link';
import { useRouter } from 'next/router';
import styled from 'styled-components';
import { Path, MENU_KEY } from '@/utils/enum';
import ApiOutlined from '@ant-design/icons/ApiOutlined';
import SidebarMenu from '@/components/sidebar/SidebarMenu';
import useKailoText from '@/utils/kailoI18n';

const Layout = styled.div`
  padding: 16px 0;
  position: absolute;
  z-index: 1;
  left: 0;
  top: 0;
  width: 100%;
  background-color: var(--kailo-sidebar);
  overflow: hidden;
`;

const MENU_KEY_MAP = {
  [Path.APIManagementHistory]: MENU_KEY.API_HISTORY,
};

const linkStyle = { color: 'inherit', transition: 'none' };

export default function APIManagement() {
  const router = useRouter();
  const t = useKailoText();

  const menuItems = [
    {
      'data-guideid': 'api-history',
      label: (
        <Link style={linkStyle} href={Path.APIManagementHistory}>
          {t('apiHistory')}
        </Link>
      ),
      icon: <ApiOutlined />,
      key: MENU_KEY.API_HISTORY,
      className: 'pl-4',
    },
  ];

  return (
    <Layout>
      <SidebarMenu
        items={menuItems}
        selectedKeys={MENU_KEY_MAP[router.pathname]}
      />
    </Layout>
  );
}
