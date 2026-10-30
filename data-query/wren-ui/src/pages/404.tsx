import Link from 'next/link';
import styled from 'styled-components';
import { Path } from '@/utils/enum';
import useKailoText from '@/utils/kailoI18n';
import useKailoPage from '@/hooks/useKailoPage';

// DD-133 §1 / DD-138 (07 §4.8.1 错误页): no upstream default 404; a neutral
// Kailo content-area state with Kailo tokens and copy. The page title is the
// Kailo product name set by KailoSessionProvider.
const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: var(--kailo-vh, 100vh);
  padding: 24px;
  text-align: center;
  background: var(--kailo-color-background);
  color: var(--kailo-color-foreground);
`;

const Title = styled.div`
  margin: 0;
  font-size: var(--kailo-text-title2);
  line-height: 24px;
  font-weight: 600;
  color: var(--kailo-color-foreground);
`;

const Description = styled.p`
  margin: 0 0 8px;
  font-size: var(--kailo-text-body);
  color: var(--kailo-color-muted-foreground);
`;

const HomeLink = styled(Link)`
  padding: 6px 14px;
  border: 1px solid var(--kailo-color-border);
  border-radius: 6px;
  font-size: var(--kailo-text-body);
  color: var(--kailo-color-foreground);
  background: var(--kailo-color-background);

  &:hover,
  &:focus {
    background: var(--kailo-color-accent);
    color: var(--kailo-color-foreground);
  }
`;

export default function NotFound() {
  const t = useKailoText();
  useKailoPage({ title: t('notFoundTitle') });
  return (
    <Wrapper>
      <Title>{t('notFoundTitle')}</Title>
      <Description>{t('notFoundDescription')}</Description>
      <HomeLink href={Path.Home}>{t('backToHome')}</HomeLink>
    </Wrapper>
  );
}
