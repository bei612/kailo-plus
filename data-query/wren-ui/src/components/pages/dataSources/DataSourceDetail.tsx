import { useEffect } from 'react';
import { Alert, Button, Descriptions, Form, Space } from 'antd';
import KailoEmpty from '@/components/kailo/KailoEmpty';
import { AlertCircleIcon, SettingsIcon } from '@/components/kailo/KailoIcons';
import { getDataSource } from '@/components/pages/setup/utils';
import {
  transformFormToProperties,
  transformPropertiesToForm,
} from '@/hooks/useSetupConnectionDataSource';
import useKailoText from '@/utils/kailoI18n';
import { notify } from '@/utils/kailoHost';
import { parseGraphQLError } from '@/utils/errorHandler';
import { DATA_SOURCES, FORM_MODE } from '@/utils/enum';
import {
  useDataSourceQuery,
  useTestDataSourceConnectionMutation,
  useUpdateDataSourceConnectionMutation,
} from '@/apollo/client/graphql/dataSources.generated';
import {
  credentialStorageText,
  DataSourceStatusTag,
  DataSourceTypeLabel,
  deniedError,
} from './DataSourceList';

// DD-169(6)①: one data source's details (connection settings without any
// credential value; credential fields only as "set") and its edit form.
// Empty credential fields keep the stored ones; the server tests the merged
// connection before storing anything and replaces Kailo-held credentials only
// when new ones were typed.

interface Props {
  id: number;
  editing: boolean;
  governed: boolean;
  onEdit: () => void;
  onClose: () => void;
  onSaved: () => void;
}

const HIDDEN = new Set(['displayName']);

export default function DataSourceDetail(props: Props) {
  const t = useKailoText();
  const [form] = Form.useForm();
  const { data, loading, error, refetch } = useDataSourceQuery({
    variables: { id: props.id },
    fetchPolicy: 'cache-and-network',
  });
  const detail = data?.dataSource;
  const [testConnection, testState] = useTestDataSourceConnectionMutation({
    onError: () => undefined,
  });
  const [update, updateState] = useUpdateDataSourceConnectionMutation({
    onError: () => undefined,
  });

  useEffect(() => {
    if (!detail || !props.editing) return;
    form.resetFields();
    form.setFieldsValue(
      transformPropertiesToForm(
        { ...detail.properties, displayName: detail.displayName },
        detail.type,
      ),
    );
    testState.reset();
  }, [detail?.id, props.editing]);

  if (error && !detail)
    return deniedError(error) ? (
      <KailoEmpty
        icon={SettingsIcon}
        title={t('dataSources.deniedTitle')}
        description={t('dataSources.deniedHint')}
      />
    ) : (
      <KailoEmpty
        icon={AlertCircleIcon}
        title={t('dataSources.loadFailedTitle')}
        description={t('dataSources.loadFailedHint', {
          reason: parseGraphQLError(error)?.shortMessage || t('actionFailed'),
        })}
        actionLabel={t('dataSources.retry')}
        onAction={() => refetch()}
      />
    );
  if (!detail || loading) return null;

  const current = getDataSource(detail.type as unknown as DATA_SOURCES);
  const formProperties = async () =>
    transformFormToProperties(await form.validateFields(), detail.type);

  const runTest = async () => {
    const properties = await formProperties().catch(() => null);
    if (!properties) return;
    await testConnection({
      variables: { id: detail.id, data: { type: detail.type, properties } },
    });
  };

  const save = async () => {
    const properties = await formProperties().catch(() => null);
    if (!properties) return;
    const response = await update({
      variables: { id: detail.id, data: { type: detail.type, properties } },
    });
    if (!response.data) return;
    notify.success(t('dataSources.updated'));
    await refetch();
    props.onSaved();
  };

  if (props.editing) {
    const result = testState.data?.testDataSourceConnection;
    const failure = parseGraphQLError(updateState.error || testState.error);
    return (
      <div className="kailo-data-source-detail">
        <Form
          form={form}
          layout="vertical"
          className="kailo-data-source-wizard__panel"
        >
          <div className="mb-4">
            <DataSourceTypeLabel type={detail.type} />
          </div>
          <current.component mode={FORM_MODE.EDIT} />
          <div className="gray-7">{t('dataSources.keepCredentialHint')}</div>
        </Form>
        {result?.ok && (
          <Alert
            className="mt-4"
            type="success"
            showIcon
            message={t('dataSources.testOk', { count: result.tableCount ?? 0 })}
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
        {failure && (
          <Alert
            className="mt-4"
            type="error"
            showIcon
            message={failure.shortMessage}
            description={failure.message}
          />
        )}
        <div className="kailo-data-source-wizard__footer">
          <Button onClick={props.onClose}>{t('cancel')}</Button>
          <Space>
            <Button onClick={runTest} loading={testState.loading}>
              {t('dataSources.testAction')}
            </Button>
            <Button type="primary" onClick={save} loading={updateState.loading}>
              {t('save')}
            </Button>
          </Space>
        </div>
      </div>
    );
  }

  const settings = Object.entries(detail.properties || {}).filter(
    ([key, value]) =>
      !HIDDEN.has(key) &&
      value !== null &&
      value !== '' &&
      (typeof value !== 'object' || Array.isArray(value)),
  );

  return (
    <div className="kailo-data-source-detail">
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label={t('dataSources.colName')}>
          {detail.displayName}
        </Descriptions.Item>
        <Descriptions.Item label={t('dataSources.fieldType')}>
          <DataSourceTypeLabel type={detail.type} />
        </Descriptions.Item>
        <Descriptions.Item label={t('dataSources.fieldStatus')}>
          <DataSourceStatusTag status={detail.status} />
        </Descriptions.Item>
        <Descriptions.Item label={t('dataSources.fieldModels')}>
          {detail.modelCount}
        </Descriptions.Item>
        <Descriptions.Item label={t('dataSources.fieldLastDeployed')}>
          {detail.lastDeployedAt
            ? new Date(detail.lastDeployedAt).toLocaleString()
            : t('dataSources.never')}
        </Descriptions.Item>
        {settings.map(([key, value]) => (
          <Descriptions.Item key={key} label={key}>
            {Array.isArray(value) ? value.join(', ') : String(value)}
          </Descriptions.Item>
        ))}
        <Descriptions.Item label={t('dataSources.fieldCredentials')}>
          {detail.credentialFields.length
            ? detail.credentialFields
                .map((field) => `${field}：${t('dataSources.credentialSet')}`)
                .join('；')
            : t('dataSources.credentialNotSet')}
        </Descriptions.Item>
        <Descriptions.Item label={t('dataSources.fieldCredentialStorage')}>
          {credentialStorageText(t, detail.credentialStorage)}
        </Descriptions.Item>
      </Descriptions>
      <div className="kailo-data-source-wizard__footer">
        <Button onClick={props.onClose}>{t('dataSources.backToList')}</Button>
        {!props.governed && (
          <Button type="primary" onClick={props.onEdit}>
            {t('dataSources.edit')}
          </Button>
        )}
      </div>
    </div>
  );
}
