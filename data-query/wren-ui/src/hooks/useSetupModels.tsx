import { useState } from 'react';
import { SETUP } from '@/utils/enum';
import {
  useListDataSourceTablesQuery,
  useSaveTablesMutation,
} from '@/apollo/client/graphql/dataSource.generated';

// DD-138(6): a step of the data source admin surface (no route of its own).
export default function useSetupModels(
  callbacks: {
    onSaved?: () => void;
    onBack?: () => void;
  } = {},
) {
  const [stepKey] = useState(SETUP.SELECT_MODELS);

  const { data, loading: fetching } = useListDataSourceTablesQuery({
    fetchPolicy: 'no-cache',
    onError: (error) => console.error(error),
  });

  // Handle errors via try/catch blocks rather than onError callback
  const [saveTablesMutation, { loading: submitting }] = useSaveTablesMutation();

  const submitModels = async (tables: string[]) => {
    try {
      await saveTablesMutation({
        variables: {
          data: { tables },
        },
      });
      callbacks.onSaved?.();
    } catch (error) {
      console.error(error);
    }
  };

  const onBack = () => {
    callbacks.onBack?.();
  };

  const onNext = (data: { selectedTables: string[] }) => {
    submitModels(data.selectedTables);
  };

  return {
    submitting,
    fetching,
    stepKey,
    onBack,
    onNext,
    tables: data?.listDataSourceTables || [],
  };
}
