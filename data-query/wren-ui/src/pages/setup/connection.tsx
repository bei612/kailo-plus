import { useMemo } from 'react';
import SimpleLayout from '@/components/layouts/SimpleLayout';
import ContainerCard from '@/components/pages/setup/ContainerCard';
import useSetupConnection from '@/hooks/useSetupConnection';
import { SETUP_STEPS, SETUP_STEP_TITLES } from '@/components/pages/setup/utils';
import useKailoPage from '@/hooks/useKailoPage';
import useKailoText from '@/utils/kailoI18n';

export default function SetupConnection() {
  const { connectError, dataSource, onBack, onNext, stepKey, submitting } =
    useSetupConnection();

  const current = useMemo(() => SETUP_STEPS[stepKey], [stepKey]);
  const t = useKailoText();

  // DD-157: Kailo page header — the onboarding step (no tabs while
  // onboarding; useKailoPage omits them).
  useKailoPage({ title: t(SETUP_STEP_TITLES[current.step]), ready: true });

  return (
    <SimpleLayout>
      <ContainerCard step={current.step} maxWidth={current.maxWidth}>
        <current.component
          connectError={connectError}
          dataSource={dataSource}
          onNext={onNext}
          onBack={onBack}
          submitting={submitting}
        />
      </ContainerCard>
    </SimpleLayout>
  );
}
