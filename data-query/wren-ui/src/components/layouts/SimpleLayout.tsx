import { Layout } from 'antd';
import KailoEmpty from '@/components/kailo/KailoEmpty';
import { SettingsIcon } from '@/components/kailo/KailoIcons';
import { useRouter } from 'next/router';
import HeaderBar from '@/components/HeaderBar';
import PageLoading from '@/components/PageLoading';
import { useWithOnboarding } from '@/hooks/useCheckOnboarding';
import clsx from 'clsx';
import { Path } from '@/utils/enum';
import useKailoSession from '@/hooks/useKailoSession';
import useKailoText from '@/utils/kailoI18n';

const { Content } = Layout;

interface Props {
  children: React.ReactNode;
  loading?: boolean;
}

export default function SimpleLayout(props: Props) {
  const { loading: fetching } = useWithOnboarding();
  const { children, loading } = props;
  const { pathname } = useRouter();
  const t = useKailoText();
  const { isAdmin, loaded, hostPage } = useKailoSession();
  // DD-133 §3: connection, onboarding and modeling are Kailo Tenant admin
  // pages (the server enforces the same rule on every write).
  const adminOnly =
    pathname.startsWith(Path.Onboarding) || pathname.startsWith(Path.Modeling);
  const blocked = adminOnly && loaded && !isAdmin;
  const pageLoading = fetching || loading || (adminOnly && !loaded);
  return (
    <Layout
      className={clsx('adm-main bg-gray-3', {
        'overflow-hidden': pageLoading,
      })}
    >
      {/* DD-152: inside Kailo the header (tabs, actions) is Kailo's. */}
      {!hostPage && <HeaderBar />}
      <Content className="adm-content">
        {blocked ? (
          // DD-152 (20 §13 空态): Kailo state, no upstream illustration.
          <KailoEmpty
            className="h-100"
            icon={SettingsIcon}
            title={t('adminRequiredTitle')}
            description={
              pathname.startsWith(Path.Onboarding)
                ? t('adminRequiredOnboarding')
                : t('adminOnly')
            }
          />
        ) : (
          children
        )}
      </Content>
      <PageLoading visible={pageLoading} />
    </Layout>
  );
}
