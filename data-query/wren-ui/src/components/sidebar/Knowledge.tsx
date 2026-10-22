import Link from 'next/link';
import { useRouter } from 'next/router';
import styled from 'styled-components';
import FunctionOutlined from '@ant-design/icons/FunctionOutlined';
import { Path, MENU_KEY } from '@/utils/enum';
import { InstructionsSVG } from '@/utils/svgs';
import SidebarMenu from '@/components/sidebar/SidebarMenu';
import useKailoText from '@/utils/kailoI18n';

const Layout = styled.div`
  padding: 16px 0;
  position: absolute;
  z-index: 1;
  left: 0;
  top: 0;
  width: 100%;
  background-color: var(--kailo-color-sidebar-background);
  overflow: hidden;
`;

const MENU_KEY_MAP = {
  [Path.KnowledgeQuestionSQLPairs]: MENU_KEY.QUESTION_SQL_PAIRS,
  [Path.KnowledgeInstructions]: MENU_KEY.INSTRUCTIONS,
};

const linkStyle = { color: 'inherit', transition: 'none' };

export default function Knowledge() {
  const router = useRouter();
  const t = useKailoText();

  const menuItems = [
    {
      'data-guideid': 'question-sql-pairs',
      label: (
        <Link style={linkStyle} href={Path.KnowledgeQuestionSQLPairs}>
          {t('questionSqlPairs')}
        </Link>
      ),
      icon: <FunctionOutlined />,
      key: MENU_KEY.QUESTION_SQL_PAIRS,
      className: 'pl-4',
    },
    {
      'data-guideid': 'instructions',
      label: (
        <Link style={linkStyle} href={Path.KnowledgeInstructions}>
          {t('instructions')}
        </Link>
      ),
      icon: <InstructionsSVG />,
      key: MENU_KEY.INSTRUCTIONS,
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
