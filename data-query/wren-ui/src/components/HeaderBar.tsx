import { useRouter } from 'next/router';
import { Button, Dropdown, Layout, Menu, Space } from 'antd';
import styled from 'styled-components';
import LogoBar from '@/components/LogoBar';
import { Path } from '@/utils/enum';
import Deploy from '@/components/deploy/Deploy';
import KailoUser from '@/components/kailo/KailoUser';
import useKailoSession from '@/hooks/useKailoSession';
import useKailoText from '@/utils/kailoI18n';

const { Header } = Layout;

// DD-133 §4: Kailo token styling; the header keeps only this component's
// business navigation. Inside Kailo the product mark and account menu are
// Kailo's own shell and are not repeated here.
const StyledButton = styled(Button)<{ $isHighlight: boolean }>`
  background: ${(props) =>
    props.$isHighlight ? 'var(--kailo-color-accent)' : 'transparent'};
  font-weight: ${(props) => (props.$isHighlight ? '600' : 'normal')};
  border: none;
  box-shadow: none;
  color: ${(props) =>
    props.$isHighlight
      ? 'var(--kailo-color-foreground)'
      : 'var(--kailo-color-muted-foreground)'};

  &:hover,
  &:focus {
    background: var(--kailo-color-accent);
    color: var(--kailo-color-foreground);
  }
`;

const StyledHeader = styled(Header)`
  height: 48px;
  border-bottom: 1px solid var(--kailo-color-border);
  background: var(--kailo-color-background);
  padding: 10px 16px;
`;

function signOut() {
  // The gateway clears this page's session (same-origin POST, Origin
  // checked) and continues to the Kailo sign-out (DD-133 §2).
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/auth/logout';
  document.body.appendChild(form);
  form.submit();
}

export default function HeaderBar() {
  const router = useRouter();
  const t = useKailoText();
  const { user, isAdmin, loaded, embedded } = useKailoSession();
  const { pathname } = router;
  const showNav = !pathname.startsWith(Path.Onboarding);
  const isModeling = pathname.startsWith(Path.Modeling);

  const account = user && (
    <KailoUser user={user} size={24} showName={!embedded} />
  );

  return (
    <StyledHeader>
      <div
        className="d-flex justify-space-between align-center"
        style={{ marginTop: -2 }}
      >
        <Space size={[32, 0]}>
          {!embedded && <LogoBar />}
          {showNav && (
            <Space size={[8, 0]}>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.Home)}
                onClick={() => router.push(Path.Home)}
              >
                {t('navHome')}
              </StyledButton>
              {loaded && isAdmin && (
                <StyledButton
                  shape="round"
                  size="small"
                  $isHighlight={pathname.startsWith(Path.Modeling)}
                  onClick={() => router.push(Path.Modeling)}
                >
                  {t('navModeling')}
                </StyledButton>
              )}
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.Knowledge)}
                onClick={() => router.push(Path.KnowledgeQuestionSQLPairs)}
              >
                {t('navKnowledge')}
              </StyledButton>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.APIManagement)}
                onClick={() => router.push(Path.APIManagementHistory)}
              >
                {t('navApi')}
              </StyledButton>
            </Space>
          )}
        </Space>
        <Space size={[16, 0]}>
          {isModeling && isAdmin && <Deploy />}
          {account &&
            (embedded ? (
              account
            ) : (
              <Dropdown
                trigger={['click']}
                overlay={
                  <Menu
                    items={[
                      {
                        key: 'sign-out',
                        label: t('signOut'),
                        onClick: signOut,
                      },
                    ]}
                  />
                }
              >
                <Button
                  type="text"
                  size="small"
                  className="d-flex align-center"
                >
                  {account}
                </Button>
              </Dropdown>
            ))}
        </Space>
      </div>
    </StyledHeader>
  );
}
