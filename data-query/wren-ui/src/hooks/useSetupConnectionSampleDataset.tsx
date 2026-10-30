import { useCallback } from 'react';
import { ONBOARDING_STATUS } from '@/apollo/client/graphql/onboarding';
import { useStartSampleDatasetMutation } from '@/apollo/client/graphql/dataSource.generated';
import { SampleDatasetName } from '@/apollo/client/graphql/__types__';

// DD-138(6): the data source admin surface shows its settings afterwards.
export default function useSetupConnectionSampleDataset(onDone?: () => void) {
  const [startSampleDatasetMutation, { loading, error }] =
    useStartSampleDatasetMutation({
      onError: (error) => console.error(error),
      onCompleted: () => onDone?.(),
      refetchQueries: [{ query: ONBOARDING_STATUS }],
      awaitRefetchQueries: true,
    });

  const saveSampleDataset = useCallback(
    async (template: SampleDatasetName) => {
      await startSampleDatasetMutation({
        variables: { data: { name: template } },
      });
    },
    [startSampleDatasetMutation],
  );

  return {
    loading,
    error,
    saveSampleDataset,
  };
}
