import { useState } from 'react';
import ProjectSettings from '@/components/settings/ProjectSettings';
import PageLoading from '@/components/PageLoading';
import KailoEmpty from '@/components/kailo/KailoEmpty';
import { DatabaseIcon } from '@/components/kailo/KailoIcons';
import KailoAdminSurface, {
  useKailoAdminPage,
} from '@/components/kailo/KailoAdminSurface';
import useOnboardingStatus from '@/hooks/useCheckOnboarding';
import { OnboardingStatus } from '@/apollo/client/graphql/__types__';
import { useGetSettingsQuery } from '@/apollo/client/graphql/settings.generated';
import { Path } from '@/utils/enum';
import useKailoText from '@/utils/kailoI18n';
import DataSourcePicker from '@/components/pages/dataSources/DataSourcePicker';

// DD-138(6) (`07` §4.8.5): the project settings admin surface — the answer
// language and the project reset. Nothing else: no product shell, no links.
export default function ProjectSurface() {
  return (
    <KailoAdminSurface path={Path.AdminProject}>
      <Project />
    </KailoAdminSurface>
  );
}

function Project() {
  const t = useKailoText();
  const status = useOnboardingStatus();
  const [reset, setReset] = useState(false);
  const noProject =
    reset || status.onboardingStatus === OnboardingStatus.NOT_STARTED;
  const { data, loading } = useGetSettingsQuery({
    fetchPolicy: 'cache-and-network',
    skip: noProject || !status.onboardingStatus,
  });

  const settings = data?.settings;
  useKailoAdminPage({ ready: noProject || !!settings || !loading });

  if (noProject)
    // The project exists once a data source is connected (or after a reset,
    // again) — on the data source connection surface.
    return (
      <KailoEmpty
        className="h-100"
        icon={DatabaseIcon}
        title={reset ? t('projectResetDone') : t('dataSourceMissingTitle')}
        description={t('projectResetDoneHint')}
      />
    );
  if (!settings) return <PageLoading visible />;
  return (
    <div className="kailo-admin-surface__form">
      {/* DD-169(6)①: the settings and the reset act on this data source. */}
      <DataSourcePicker hint />
      <ProjectSettings
        data={{ language: settings.language }}
        onReset={() => setReset(true)}
      />
    </div>
  );
}
