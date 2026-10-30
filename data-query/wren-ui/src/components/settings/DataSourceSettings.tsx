import Image from 'next/image';
import { useEffect, useMemo } from 'react';
import { Button, Form, Alert, Typography } from 'antd';
import { confirm, notify } from '@/utils/kailoHost';
import useKailoText from '@/utils/kailoI18n';
import { makeIterable } from '@/utils/iteration';
import { DATA_SOURCES, FORM_MODE } from '@/utils/enum';
import { getDataSource, getTemplates } from '@/components/pages/setup/utils';
import { FlexLoading } from '@/components/PageLoading';
import ButtonItem from '@/components/pages/setup/ButtonItem';
import {
  transformFormToProperties,
  transformPropertiesToForm,
} from '@/hooks/useSetupConnectionDataSource';
import { parseGraphQLError } from '@/utils/errorHandler';
import {
  useStartSampleDatasetMutation,
  useUpdateDataSourceMutation,
} from '@/apollo/client/graphql/dataSource.generated';
import {
  DataSourceName,
  SampleDatasetName,
} from '@/apollo/client/graphql/__types__';

interface Props {
  type: DataSourceName;
  properties: Record<string, any>;
  sampleDataset: SampleDatasetName;
  refetchSettings: () => void;
}

const SampleDatasetIterator = makeIterable(ButtonItem);

const SampleDatasetPanel = (props: Props) => {
  const { sampleDataset, refetchSettings } = props;
  const t = useKailoText();
  const templates = getTemplates();
  const [startSampleDataset] = useStartSampleDatasetMutation({
    onError: (error) => console.error(error),
    // DD-138(6): the admin surface stays open and shows the new dataset.
    onCompleted: () => refetchSettings(),
    refetchQueries: 'active',
  });

  const onSelect = (name: SampleDatasetName) => {
    const isCurrentTemplate = sampleDataset === name;
    if (!isCurrentTemplate) {
      const template = templates.find((item) => item.value === name);
      // Replaces the dataset and deletes every conversation: danger.
      void confirm({
        tone: 'danger',
        title: t('setup.changeSampleDatasetConfirm', { name: template.label }),
        description: t('setup.changeSampleDatasetHint'),
        confirmLabel: t('setup.change'),
        cancelLabel: t('cancel'),
      }).then(async (confirmed) => {
        if (confirmed)
          await startSampleDataset({ variables: { data: { name } } });
      });
    }
  };

  return (
    <>
      <div className="mb-2">{t('setup.changeSampleDataset')}</div>
      <div className="d-grid grid-columns-3 g-4">
        <SampleDatasetIterator
          data={templates}
          selectedTemplate={sampleDataset}
          onSelect={onSelect}
        />
      </div>
      <Typography.Paragraph type="secondary" className="mt-1">
        {t('setup.changeSampleDatasetHint')}
      </Typography.Paragraph>
    </>
  );
};

const DataSourcePanel = (props: Props) => {
  const { type, properties, refetchSettings } = props;
  const t = useKailoText();

  const current = getDataSource(type as unknown as DATA_SOURCES);
  const [form] = Form.useForm();

  const [updateDataSource, { loading, error }] = useUpdateDataSourceMutation({
    onError: (error) => console.error(error),
    onCompleted: async () => {
      refetchSettings();
      notify.success(t('setup.dataSourceUpdated'));
    },
  });

  const updateError = useMemo(() => parseGraphQLError(error), [error]);

  useEffect(() => properties && reset(), [properties]);

  const reset = () => {
    form.setFieldsValue(transformPropertiesToForm(properties, type));
  };

  const submit = () => {
    form
      .validateFields()
      .then((values) => {
        updateDataSource({
          variables: {
            data: { properties: transformFormToProperties(values, type) },
          },
        });
      })
      .catch((error) => {
        console.error(error);
      });
  };

  if (!type) return <FlexLoading align="center" height={150} />;

  return (
    <>
      <div className="d-flex align-center">
        <Image
          className="mr-2"
          src={current.logo}
          alt={current.label}
          width="24"
          height="24"
        />
        {current.label}
      </div>
      <Form form={form} layout="vertical" className="py-3 px-4">
        <current.component mode={FORM_MODE.EDIT} />

        {updateError && (
          <Alert
            message={updateError.shortMessage}
            description={updateError.message}
            type="error"
            showIcon
            className="my-6"
          />
        )}

        <div className="py-2 text-right">
          <Button className="mr-2" onClick={reset}>
            {t('cancel')}
          </Button>
          <Button type="primary" onClick={submit} loading={loading}>
            {t('save')}
          </Button>
        </div>
      </Form>
    </>
  );
};

export default function DataSourceSettings(props: Props) {
  const { sampleDataset } = props;
  const Component = sampleDataset ? SampleDatasetPanel : DataSourcePanel;
  return (
    <div className="py-3 px-4">
      <Component {...props} />
    </div>
  );
}
