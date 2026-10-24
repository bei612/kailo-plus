import { ComponentProps, useState } from 'react';
import { Typography, Row, Col } from 'antd';
import { getDataSources, getTemplates } from './utils';
import { makeIterable } from '@/utils/iteration';
import ButtonItem from './ButtonItem';
import useKailoText from '@/utils/kailoI18n';
import useKailoSession from '@/hooks/useKailoSession';
import {
  DataSourceName,
  SampleDatasetName,
} from '@/apollo/client/graphql/__types__';

const ButtonTemplate = (props: ComponentProps<typeof ButtonItem>) => {
  return (
    <Col span={6} key={props.label}>
      <ButtonItem {...props} />
    </Col>
  );
};

const DataSourceIterator = makeIterable(ButtonTemplate);
const TemplatesIterator = makeIterable(ButtonTemplate);

export default function Starter(props) {
  const { onNext, submitting } = props;

  const [template, setTemplate] = useState<SampleDatasetName>();
  const t = useKailoText();
  // Inside Kailo the step title is the page header (no second title).
  const { hostPage } = useKailoSession();

  const dataSources = getDataSources();
  const templates = getTemplates();

  const onSelectDataSource = (value: DataSourceName) => {
    onNext && onNext({ dataSource: value });
  };

  const onSelectTemplate = (value: string) => {
    setTemplate(value as SampleDatasetName);
    onNext && onNext({ template: value });
  };

  return (
    <>
      {!hostPage && (
        <Typography.Title level={2} className="mb-3">
          {t('setup.connectDataSource')}
        </Typography.Title>
      )}
      <Row className="mt-4" gutter={[16, 16]}>
        <DataSourceIterator
          data={dataSources}
          onSelect={onSelectDataSource}
          submitting={submitting}
        />
      </Row>

      {templates.length > 0 && (
        <>
          <div className="py-8" />
          <Typography.Title level={2} className="mb-3">
            {t('setup.sampleData')}
          </Typography.Title>
          <Row className="mt-6" gutter={[16, 16]}>
            <TemplatesIterator
              data={templates}
              onSelect={onSelectTemplate}
              submitting={submitting}
              selectedTemplate={template}
            />
          </Row>
        </>
      )}

      <div className="py-12" />
    </>
  );
}
