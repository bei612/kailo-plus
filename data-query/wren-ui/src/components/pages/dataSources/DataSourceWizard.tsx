import Image from 'next/image';
import { useState } from 'react';
import { useApolloClient } from '@apollo/client';
import { Alert, Button, Form, Steps } from 'antd';
import Starter from '@/components/pages/setup/Starter';
import { getDataSource, SETUP_STEPS } from '@/components/pages/setup/utils';
import useSetupModels from '@/hooks/useSetupModels';
import useSetupRelations from '@/hooks/useSetupRelations';
import { transformFormToProperties } from '@/hooks/useSetupConnectionDataSource';
import useKailoText from '@/utils/kailoI18n';
import { notify } from '@/utils/kailoHost';
import { parseGraphQLError } from '@/utils/errorHandler';
import { selectDataSource } from '@/utils/dataSourceSelection';
import { DATA_SOURCES } from '@/utils/enum/dataSources';
import { DataSourceName } from '@/apollo/client/graphql/__types__';
import {
  useCreateDataSourceMutation,
  useTestDataSourceConnectionMutation,
} from '@/apollo/client/graphql/dataSources.generated';

// DD-169(6)①: the new data source wizard of the admin surface — choose a
// type, fill in the settings, test the connection, then (once saved as a new
// data source, which becomes this tab's current one) select the tables and
// define the relationships, which deploys the models. Nothing is stored before
// the test succeeds; credentials go to Kailo custody on save (DD-169(5)).

enum Step {
  TYPE = 0,
  PARAMS = 1,
  TEST = 2,
  TABLES = 3,
  RELATIONS = 4,
}

interface Props {
  onCancel: () => void;
  onFinished: (id: number) => void;
}

export default function DataSourceWizard(props: Props) {
  const t = useKailoText();
  const client = useApolloClient();
  const [form] = Form.useForm();
  const [step, setStep] = useState<Step>(Step.TYPE);
  const [type, setType] = useState<DataSourceName>();
  const [values, setValues] = useState<Record<string, any>>();
  const [created, setCreated] = useState<{ id: number; name: string }>();

  const [testConnection, testState] = useTestDataSourceConnectionMutation({
    onError: () => undefined,
  });
  const [createDataSource, createState] = useCreateDataSourceMutation({
    onError: () => undefined,
  });

  const current = type ? getDataSource(type as unknown as DATA_SOURCES) : null;
  const properties = () =>
    values && type ? transformFormToProperties(values, type) : undefined;
  const result = testState.data?.testDataSourceConnection;
  const tested = !!result && (result.ok || result.deferred);

  const runTest = async () => {
    await testConnection({
      variables: { data: { type, properties: properties() } },
    });
  };

  const save = async () => {
    const response = await createDataSource({
      variables: { data: { type, properties: properties() } },
    });
    const id = response.data?.createDataSource?.id;
    if (!id) return;
    const name = String(values?.displayName || '').trim();
    setCreated({ id, name });
    // The new data source is this tab's current one: the table and
    // relationship steps below address it.
    selectDataSource(id);
    await client.resetStore().catch(() => undefined);
    notify.success(t('dataSources.created', { name }));
    setStep(Step.TABLES);
  };

  const createError = parseGraphQLError(createState.error);
  const testError = parseGraphQLError(testState.error);

  return (
    <div className="kailo-data-source-wizard">
      <Steps
        className="kailo-data-source-wizard__steps"
        size="small"
        current={step}
      >
        <Steps.Step title={t('dataSources.stepType')} />
        <Steps.Step title={t('dataSources.stepParams')} />
        <Steps.Step title={t('dataSources.stepTest')} />
        <Steps.Step title={t('dataSources.stepTables')} />
        <Steps.Step title={t('dataSources.stepRelations')} />
      </Steps>

      {step === Step.TYPE && (
        <>
          <Starter
            submitting={false}
            onNext={({ dataSource }) => {
              if (!dataSource) return;
              setType(dataSource);
              form.resetFields();
              testState.reset();
              setStep(Step.PARAMS);
            }}
          />
          <div className="kailo-data-source-wizard__footer">
            <Button onClick={props.onCancel}>{t('cancel')}</Button>
          </div>
        </>
      )}

      {step === Step.PARAMS && current && (
        <>
          <Form
            form={form}
            layout="vertical"
            className="kailo-data-source-wizard__panel"
            initialValues={values}
          >
            <TypeHeading type={type} />
            <current.component />
          </Form>
          <div className="kailo-data-source-wizard__footer">
            <Button onClick={() => setStep(Step.TYPE)}>
              {t('setup.back')}
            </Button>
            <Button
              type="primary"
              onClick={() =>
                form
                  .validateFields()
                  .then((next) => {
                    setValues(next);
                    testState.reset();
                    setStep(Step.TEST);
                  })
                  .catch(() => undefined)
              }
            >
              {t('setup.next')}
            </Button>
          </div>
        </>
      )}

      {step === Step.TEST && current && (
        <>
          <div className="kailo-data-source-wizard__panel">
            <TypeHeading type={type} />
            <div className="mb-4">{String(values?.displayName || '')}</div>
            <Button
              onClick={runTest}
              loading={testState.loading}
              disabled={createState.loading}
            >
              {testState.loading
                ? t('dataSources.testing')
                : t('dataSources.testAction')}
            </Button>
            {result?.ok && (
              <Alert
                className="mt-4"
                type="success"
                showIcon
                message={t('dataSources.testOk', {
                  count: result.tableCount ?? 0,
                })}
              />
            )}
            {result?.deferred && (
              <Alert
                className="mt-4"
                type="info"
                showIcon
                message={t('dataSources.testDeferred')}
              />
            )}
            {result && !result.ok && !result.deferred && (
              <Alert
                className="mt-4"
                type="error"
                showIcon
                message={t('dataSources.testFailed')}
                description={result.error}
              />
            )}
            {(testError || createError) && (
              <Alert
                className="mt-4"
                type="error"
                showIcon
                message={(createError || testError).shortMessage}
                description={(createError || testError).message}
              />
            )}
            {!tested && !testState.loading && !result && (
              <div className="gray-7 mt-4">{t('dataSources.testRequired')}</div>
            )}
          </div>
          <div className="kailo-data-source-wizard__footer">
            <Button
              onClick={() => setStep(Step.PARAMS)}
              disabled={createState.loading}
            >
              {t('setup.back')}
            </Button>
            <Button
              type="primary"
              disabled={!tested}
              loading={createState.loading}
              onClick={save}
            >
              {t('dataSources.saveAndContinue')}
            </Button>
          </div>
        </>
      )}

      {step === Step.TABLES && (
        <TablesStep onSaved={() => setStep(Step.RELATIONS)} />
      )}

      {step === Step.RELATIONS && created && (
        <RelationsStep
          onBack={() => setStep(Step.TABLES)}
          onFinish={() => {
            notify.success(t('dataSources.finished', { name: created.name }));
            props.onFinished(created.id);
          }}
        />
      )}
    </div>
  );
}

function TypeHeading(props: { type?: DataSourceName }) {
  if (!props.type) return null;
  const current = getDataSource(props.type as unknown as DATA_SOURCES);
  return (
    <div className="d-flex align-center mb-4 text-medium">
      <Image
        className="mr-2"
        src={current.logo}
        alt={current.label}
        width="32"
        height="32"
      />
      {current.label}
    </div>
  );
}

function TablesStep(props: { onSaved: () => void }) {
  const { fetching, stepKey, tables, onNext, onBack, submitting } =
    useSetupModels({ onSaved: props.onSaved });
  const Current = SETUP_STEPS[stepKey].component;
  return (
    <Current
      fetching={fetching}
      onBack={onBack}
      onNext={onNext}
      submitting={submitting}
      tables={tables}
    />
  );
}

function RelationsStep(props: { onFinish: () => void; onBack: () => void }) {
  const {
    fetching,
    stepKey,
    recommendRelationsResult,
    onNext,
    onBack,
    onSkip,
    submitting,
  } = useSetupRelations(props);
  const Current = SETUP_STEPS[stepKey].component;
  return (
    <Current
      fetching={fetching}
      {...recommendRelationsResult}
      onNext={onNext}
      onBack={onBack}
      onSkip={onSkip}
      submitting={submitting}
    />
  );
}
