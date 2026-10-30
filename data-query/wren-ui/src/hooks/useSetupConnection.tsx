import { useState, useEffect } from 'react';
import { SETUP } from '@/utils/enum';
import { parseGraphQLError } from '@/utils/errorHandler';
import useSetupConnectionDataSource from './useSetupConnectionDataSource';
import useSetupConnectionSampleDataset from './useSetupConnectionSampleDataset';
import {
  DataSourceName,
  SampleDatasetName,
} from '@/apollo/client/graphql/__types__';

type StepData = {
  dataSource?: DataSourceName;
  template?: SampleDatasetName;
  properties?: JSON;
};

// DD-138(6): the first step of the data source admin surface.
export default function useSetupConnection(
  callbacks: {
    onDataSourceSaved?: () => void;
    onSampleDatasetStarted?: () => void;
  } = {},
) {
  const [stepKey, setStepKey] = useState(SETUP.STARTER);
  const setupConnectionSampleDataset = useSetupConnectionSampleDataset(
    callbacks.onSampleDatasetStarted,
  );
  const setupConnectionDataSource = useSetupConnectionDataSource(
    callbacks.onDataSourceSaved,
  );
  const [connectError, setConnectError] = useState(null);

  const dataSource = setupConnectionDataSource.selected;
  const submitting =
    setupConnectionDataSource.loading || setupConnectionSampleDataset.loading;

  useEffect(() => {
    if (stepKey === SETUP.CREATE_DATA_SOURCE) {
      setConnectError(null);
    }
  }, [stepKey]);

  useEffect(() => {
    setConnectError(parseGraphQLError(setupConnectionDataSource.error));
  }, [setupConnectionDataSource.error]);

  const onBack = () => {
    if (stepKey === SETUP.CREATE_DATA_SOURCE) {
      setStepKey(SETUP.STARTER);
      setupConnectionDataSource.reset();
    }
  };

  const onNext = (data?: StepData) => {
    const dispatchStarter = (data: StepData) => {
      if (data.dataSource) {
        setupConnectionDataSource.selectDataSourceNext({
          dataSource: data.dataSource,
          dispatch: () => setStepKey(SETUP.CREATE_DATA_SOURCE),
        });
      } else {
        setupConnectionSampleDataset.saveSampleDataset(data.template);
      }
    };

    const dispatchCreateDataSource = (data: StepData) => {
      setupConnectionDataSource.saveDataSource(data.properties);
    };

    // Next strategy
    if (stepKey === SETUP.STARTER) {
      dispatchStarter(data);
    } else if (stepKey === SETUP.CREATE_DATA_SOURCE) {
      dispatchCreateDataSource(data);
    }
  };

  return {
    stepKey,
    dataSource,
    onBack,
    onNext,
    submitting,
    connectError,
  };
}
