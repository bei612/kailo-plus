import { useMemo, useState } from 'react';
import ContainerCard from '@/components/pages/setup/ContainerCard';
import { SETUP_STEPS } from '@/components/pages/setup/utils';
import DataSourceSettings from '@/components/settings/DataSourceSettings';
import PageLoading from '@/components/PageLoading';
import ErrorCollapse from '@/components/ErrorCollapse';
import KailoAdminSurface, {
  useKailoAdminPage,
} from '@/components/kailo/KailoAdminSurface';
import useOnboardingStatus from '@/hooks/useCheckOnboarding';
import useSetupConnection from '@/hooks/useSetupConnection';
import useSetupModels from '@/hooks/useSetupModels';
import useSetupRelations from '@/hooks/useSetupRelations';
import { Path } from '@/utils/enum';
import { useGetSettingsQuery } from '@/apollo/client/graphql/settings.generated';
import {
  dataSourceSurfaceStep,
  DataSourceSurfaceStep,
} from '@/utils/kailoAdminSurface';

// DD-138(6) (`07` §4.8.5): the data source connection admin surface. Without
// a connected and modeled data source it is the first-use flow (connect →
// choose tables → relationships, the original onboarding steps); afterwards
// it is the connection settings. Nothing else: no product shell, no links.
export default function DataSourceSurface() {
  return (
    <KailoAdminSurface path={Path.AdminDataSource}>
      <DataSourceConnection />
    </KailoAdminSurface>
  );
}

function DataSourceConnection() {
  const { onboardingStatus, loading, error, refetch } = useOnboardingStatus();
  // The flow moves on locally: saving the tables already finishes the
  // onboarding status, yet the relationships step follows.
  const [override, setOverride] = useState<DataSourceSurfaceStep | null>(null);
  const step = override || dataSourceSurfaceStep(onboardingStatus);

  useKailoAdminPage({ ready: !loading });

  const toSettings = () => {
    setOverride('settings');
    refetch();
  };

  if (!step)
    return error ? (
      <div className="kailo-admin-surface__form">
        <ErrorCollapse message={error.message} defaultActive />
      </div>
    ) : (
      <PageLoading visible />
    );
  if (step === 'connection')
    return (
      <ConnectionStep
        onDataSourceSaved={() => setOverride('models')}
        onSampleDatasetStarted={toSettings}
      />
    );
  if (step === 'models')
    return (
      <ModelsStep
        onSaved={() => setOverride('relationships')}
        onBack={() => setOverride('connection')}
      />
    );
  if (step === 'relationships')
    return (
      <RelationshipsStep
        onFinish={toSettings}
        onBack={() => setOverride('models')}
      />
    );
  return <ConnectionSettings />;
}

function ConnectionStep(props: {
  onDataSourceSaved: () => void;
  onSampleDatasetStarted: () => void;
}) {
  const { connectError, dataSource, onBack, onNext, stepKey, submitting } =
    useSetupConnection(props);
  const current = useMemo(() => SETUP_STEPS[stepKey], [stepKey]);
  return (
    <ContainerCard step={current.step} maxWidth={current.maxWidth}>
      <current.component
        connectError={connectError}
        dataSource={dataSource}
        onNext={onNext}
        onBack={onBack}
        submitting={submitting}
      />
    </ContainerCard>
  );
}

function ModelsStep(props: { onSaved: () => void; onBack: () => void }) {
  const { fetching, stepKey, tables, onNext, onBack, submitting } =
    useSetupModels(props);
  const current = useMemo(() => SETUP_STEPS[stepKey], [stepKey]);
  return (
    <ContainerCard step={current.step} maxWidth={current.maxWidth}>
      <current.component
        fetching={fetching}
        onBack={onBack}
        onNext={onNext}
        submitting={submitting}
        tables={tables}
      />
    </ContainerCard>
  );
}

function RelationshipsStep(props: {
  onFinish: () => void;
  onBack: () => void;
}) {
  const {
    fetching,
    stepKey,
    recommendRelationsResult,
    onNext,
    onBack,
    onSkip,
    submitting,
  } = useSetupRelations(props);
  const current = useMemo(() => SETUP_STEPS[stepKey], [stepKey]);
  return (
    <ContainerCard step={current.step} maxWidth={current.maxWidth}>
      <current.component
        fetching={fetching}
        {...recommendRelationsResult}
        onNext={onNext}
        onBack={onBack}
        onSkip={onSkip}
        submitting={submitting}
      />
    </ContainerCard>
  );
}

function ConnectionSettings() {
  const { data, refetch } = useGetSettingsQuery({
    fetchPolicy: 'cache-and-network',
  });
  const dataSource = data?.settings?.dataSource;
  return (
    <div className="kailo-admin-surface__form">
      <DataSourceSettings
        type={dataSource?.type}
        sampleDataset={dataSource?.sampleDataset}
        properties={dataSource?.properties}
        refetchSettings={refetch}
      />
    </div>
  );
}
