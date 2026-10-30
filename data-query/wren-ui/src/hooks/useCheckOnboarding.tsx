import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useOnboardingStatusQuery } from '@/apollo/client/graphql/onboarding.generated';
import { OnboardingStatus } from '@/apollo/client/graphql/__types__';
import { Path } from '@/utils/enum';

// DD-138(6) (`07` §4.8.5 obligation 4): the data source connection, table
// selection and relationships are the Kailo admin surface "数据源连接". A
// business page never opens that flow: without a modeled data source it shows
// the Kailo empty state (SimpleLayout), for admins and members alike.
export function dataSourceMissing(status: OnboardingStatus | undefined) {
  return (
    status === OnboardingStatus.NOT_STARTED ||
    status === OnboardingStatus.DATASOURCE_SAVED
  );
}

export const useWithOnboarding = () => {
  const router = useRouter();
  const { data, loading } = useOnboardingStatusQuery();

  const onboardingStatus = data?.onboardingStatus?.status;

  // The index page is the business home (asking) for everyone.
  useEffect(() => {
    if (router.pathname === '/') router.replace(Path.Home);
  }, [router.pathname]);

  return {
    loading,
    onboardingStatus,
    dataSourceMissing: dataSourceMissing(onboardingStatus),
  };
};

export default function useOnboardingStatus() {
  const { data, loading, error, refetch } = useOnboardingStatusQuery();

  return {
    loading,
    error,
    refetch,
    onboardingStatus: data?.onboardingStatus?.status,
  };
}
