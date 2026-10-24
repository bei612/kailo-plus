import Image from 'next/image';
import { Alert, Typography, Form, Row, Col, Button } from 'antd';
import styled from 'styled-components';
import { DATA_SOURCES } from '@/utils/enum/dataSources';
import { getDataSource, getPostgresErrorMessage } from './utils';
import useKailoText from '@/utils/kailoI18n';
import useKailoSession from '@/hooks/useKailoSession';

const StyledForm = styled(Form)`
  border: 1px var(--kailo-color-border) solid;
  border-radius: 12px;
  max-width: 720px;
`;

const DataSource = styled.div`
  border: 1px var(--kailo-color-border) solid;
  border-radius: 8px;
  background: var(--kailo-color-muted);
  color: var(--kailo-color-foreground);
`;

interface Props {
  dataSource: DATA_SOURCES;
  onNext: (data: any) => void;
  onBack: () => void;
  submitting: boolean;
  connectError?: Record<string, any>;
}

export default function ConnectDataSource(props: Props) {
  const { connectError, dataSource, submitting, onNext, onBack } = props;
  const [form] = Form.useForm();
  const current = getDataSource(dataSource);
  const t = useKailoText();
  // Inside Kailo the step title is the page header (no second title).
  const { hostPage } = useKailoSession();

  const submit = () => {
    form
      .validateFields()
      .then((values) => {
        onNext && onNext({ properties: values });
      })
      .catch((error) => {
        console.error(error);
      });
  };

  return (
    <>
      {!hostPage && (
        <Typography.Title level={2} className="mb-3">
          {t('setup.connectDataSource')}
        </Typography.Title>
      )}
      <StyledForm form={form} layout="vertical" className="p-6 my-6">
        <Row align="middle" className="mb-6">
          <Col span={12}>
            <DataSource className="d-inline-block px-4 py-2">
              <Image
                className="mr-2"
                src={current.logo}
                alt={dataSource}
                width="40"
                height="40"
              />
              {current.label}
            </DataSource>
          </Col>
        </Row>
        <current.component />
      </StyledForm>

      {connectError && (
        <Alert
          message={connectError.shortMessage}
          description={
            dataSource === DATA_SOURCES.POSTGRES
              ? getPostgresErrorMessage(connectError)
              : connectError.message
          }
          type="error"
          showIcon
          className="my-6"
        />
      )}

      <Row gutter={16} className="pt-6">
        <Col span={12}>
          <Button
            onClick={onBack}
                        className="adm-onboarding-btn"
            disabled={submitting}
          >
            {t('setup.back')}
          </Button>
        </Col>
        <Col className="text-right" span={12}>
          <Button
            type="primary"
                        onClick={submit}
            loading={submitting}
            className="adm-onboarding-btn"
          >
            {t('setup.next')}
          </Button>
        </Col>
      </Row>
    </>
  );
}
