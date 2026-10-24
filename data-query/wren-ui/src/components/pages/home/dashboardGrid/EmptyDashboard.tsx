import { useRouter } from 'next/router';
import KailoEmpty from '@/components/kailo/KailoEmpty';
import { DashboardIcon } from '@/components/kailo/KailoIcons';
import useKailoText from '@/utils/kailoI18n';
import { Path } from '@/utils/enum';

// DD-152 (20 §13 空态): line illustration, title, description, one action.
const EmptyDashboard = (props: {
  show: boolean;
  children: React.ReactNode;
}) => {
  const { show, children } = props;
  const t = useKailoText();
  const router = useRouter();
  if (show) {
    return (
      <div
        className="d-flex align-center justify-center flex-column"
        style={{ height: '100%' }}
      >
        <KailoEmpty
          icon={DashboardIcon}
          title={t('home.emptyDashboardTitle')}
          description={t('home.emptyDashboardDescription')}
          actionLabel={t('newConversationAction')}
          onAction={() => router.push(Path.Home)}
        />
      </div>
    );
  }
  return <>{children}</>;
};

export default EmptyDashboard;
