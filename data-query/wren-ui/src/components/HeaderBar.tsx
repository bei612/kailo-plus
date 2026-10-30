import { useRouter } from 'next/router';
import { Layout, Space } from 'antd';
import styled from 'styled-components';
import LogoBar from '@/components/LogoBar';
import KailoUser from '@/components/kailo/KailoUser';
import useKailoSession from '@/hooks/useKailoSession';
import { KAILO_TABS, pageTabs } from '@/hooks/useKailoPage';
import { headerAccount } from '@/utils/kailoShell';

const { Header } = Layout;

// DD-157: rendered only on top-level visits (sign-in redirects, direct
// links); inside Kailo the same tabs and actions are Kailo's page header
// (useKailoPage). Tabs follow 20 §13: 2px brand underline, selected text 600.
// DD-138 §2: no account menu or sign-out in either mode. DD-138(6): no
// admin entries (settings, modeling, deploy) — those are Kailo admin surfaces.
const StyledHeader = styled(Header)`
  height: 48px;
  line-height: normal;
  border-bottom: 1px solid var(--kailo-color-border);
  background: var(--kailo-color-background);
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const Tab = styled.button<{ $active: boolean }>`
  height: 48px;
  padding: 0 4px;
  margin: 0 8px;
  border: 0;
  border-bottom: 2px solid
    ${(props) => (props.$active ? 'var(--kailo-color-brand)' : 'transparent')};
  background: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: ${(props) => (props.$active ? 600 : 500)};
  color: ${(props) =>
    props.$active
      ? 'var(--kailo-color-foreground)'
      : 'var(--kailo-color-muted-foreground)'};
  transition: color var(--kailo-duration-fast) var(--kailo-ease-standard);

  &:hover {
    color: var(--kailo-color-foreground);
  }
`;

export default function HeaderBar() {
  const router = useRouter();
  const { user, embedded } = useKailoSession();
  const { tabs, activeTab } = pageTabs(router.locale, router.pathname);

  const account = headerAccount(embedded, !!user) === 'identity' && (
    <KailoUser user={user} size={24} />
  );

  return (
    <StyledHeader>
      <Space size={[24, 0]} style={{ height: '100%' }}>
        {!embedded && <LogoBar />}
        <nav className="d-flex" style={{ height: 48 }}>
          {tabs.map((tab) => (
            <Tab
              key={tab.id}
              type="button"
              $active={tab.id === activeTab}
              onClick={() =>
                router.push(KAILO_TABS.find((def) => def.id === tab.id).path)
              }
            >
              {tab.label}
            </Tab>
          ))}
        </nav>
      </Space>
      <Space size={[12, 0]}>{account}</Space>
    </StyledHeader>
  );
}
