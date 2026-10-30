import { Layout } from 'antd';
import KailoEmpty from '@/components/kailo/KailoEmpty';
import { DatabaseIcon } from '@/components/kailo/KailoIcons';
import HeaderBar from '@/components/HeaderBar';
import PageLoading from '@/components/PageLoading';
import { useWithOnboarding } from '@/hooks/useCheckOnboarding';
import clsx from 'clsx';
import useKailoSession from '@/hooks/useKailoSession';
import useKailoText from '@/utils/kailoI18n';

const { Content } = Layout;

interface Props {
  children: React.ReactNode;
  loading?: boolean;
}

// The business page frame (asking, knowledge, API). Admin functions are Kailo
// admin surfaces (DD-138(6)) and never use this frame.
export default function SimpleLayout(props: Props) {
  const { loading: fetching, dataSourceMissing } = useWithOnboarding();
  const { children, loading } = props;
  const t = useKailoText();
  const { hostPage } = useKailoSession();
  const pageLoading = fetching || (!dataSourceMissing && loading);
  return (
    <Layout
      className={clsx('adm-main bg-gray-3', {
        'overflow-hidden': pageLoading,
      })}
    >
      {/* DD-157: inside Kailo the header (tabs, actions) is Kailo's. */}
      {!hostPage && <HeaderBar />}
      <Content className="adm-content">
        {dataSourceMissing ? (
          // DD-138(6) first use (`07` §4.8.5 obligation 4): the connection is
          // made in the Kailo admin area, never from a business page.
          <KailoEmpty
            className="h-100"
            icon={DatabaseIcon}
            title={t('dataSourceMissingTitle')}
            description={t('dataSourceMissingHint')}
          />
        ) : (
          children
        )}
      </Content>
      <PageLoading visible={pageLoading} />
    </Layout>
  );
}
