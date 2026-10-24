import { useMemo } from 'react';
import SimpleLayout from '@/components/layouts/SimpleLayout';
import ContainerCard from '@/components/pages/setup/ContainerCard';
import useSetupModels from '@/hooks/useSetupModels';
import {
  SETUP_STEPS,
  SETUP_STEP_TITLES,
} from '@/components/pages/setup/utils';
import useKailoPage from '@/hooks/useKailoPage';
import useKailoText from '@/utils/kailoI18n';

export default function SetupModels() {
  const { fetching, stepKey, tables, onNext, onBack, submitting } =
    useSetupModels();

  const current = useMemo(() => SETUP_STEPS[stepKey], [stepKey]);
  const t = useKailoText();

  // DD-152: Kailo page header — the onboarding step (no tabs while
  // onboarding; useKailoPage omits them).
  useKailoPage({ title: t(SETUP_STEP_TITLES[current.step]), ready: true });

  return (
    <SimpleLayout>
      <ContainerCard step={current.step} maxWidth={current.maxWidth}>
        <current.component
          fetching={fetching}
          onBack={onBack}
          onNext={onNext}
          submitting={submitting}
          tables={tables}
        />
      </ContainerCard>
    </SimpleLayout>
  );
}
