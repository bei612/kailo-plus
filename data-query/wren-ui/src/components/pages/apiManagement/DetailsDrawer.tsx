import { Drawer, Typography, Row, Col, Tag, Button } from 'antd';
import { useRouter } from 'next/router';
import { getAbsoluteTime } from '@/utils/time';
import { DrawerAction } from '@/hooks/useDrawerAction';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import CloseCircleOutlined from '@ant-design/icons/CloseCircleOutlined';
import JsonCodeBlock from '@/components/code/JsonCodeBlock';
import { ApiHistoryResponse, ApiType } from '@/apollo/client/graphql/__types__';
import { getApiHistoryText } from '@/utils/language';
import useKailoText from '@/utils/kailoI18n';
import { apiTypeLabel } from '@/components/pages/apiManagement/apiTypeLabel';

type Props = DrawerAction<ApiHistoryResponse> & {
  loading?: boolean;
  onObserve?: (record: ApiHistoryResponse) => Promise<void>;
};

export default function DetailsDrawer(props: Props) {
  const { visible, onClose, defaultValue } = props;
  const { locale } = useRouter();
  const text = getApiHistoryText(locale);
  const t = useKailoText();

  const {
    threadId,
    apiType,
    createdAt,
    durationMs,
    statusCode,
    headers,
    requestPayload,
    responsePayload,
  } = defaultValue || {};

  const getStatusTag = (status: number) => {
    if (status === 202) return <Tag color="warning">{text.unknown}</Tag>;
    const isSuccess = status >= 200 && status < 300;
    return (
      <Tag
        icon={isSuccess ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
        color={isSuccess ? 'success' : 'error'}
      >
        {status}
      </Tag>
    );
  };

  return (
    <Drawer
      visible={visible}
      title={t('knowledge.apiDetails')}
      width={480}
      closable
      destroyOnClose
      onClose={onClose}
      footer={null}
    >
      <Row className="mb-6">
        <Col span={12}>
          <Typography.Text type="secondary" className="d-block mb-2">
            {t('knowledge.apiType')}
          </Typography.Text>
          <div>
            <Tag>{apiTypeLabel(locale, apiType)}</Tag>
          </div>
        </Col>
        <Col span={12}>
          <Typography.Text type="secondary" className="d-block mb-2">
            {t('knowledge.threadId')}
          </Typography.Text>
          <div>{threadId || '-'}</div>
        </Col>
      </Row>
      <Row className="mb-6">
        <Col span={12}>
          <Typography.Text type="secondary" className="d-block mb-2">
            {t('knowledge.createdTime')}
          </Typography.Text>
          <div>{getAbsoluteTime(createdAt)}</div>
        </Col>
        <Col span={12}>
          <Typography.Text type="secondary" className="d-block mb-2">
            {t('knowledge.duration')}
          </Typography.Text>
          <div>{durationMs} ms</div>
        </Col>
      </Row>
      <Row className="mb-6">
        <Col span={12}>
          <Typography.Text type="secondary" className="d-block mb-2">
            {t('knowledge.statusCode')}
          </Typography.Text>
          <div>
            {getStatusTag(statusCode)}
            {statusCode === 202 &&
              props.onObserve &&
              [
                ApiType.CREATE_SQL_PAIR,
                ApiType.UPDATE_SQL_PAIR,
                ApiType.DELETE_SQL_PAIR,
              ].includes(apiType) && (
                <Button
                  size="small"
                  className="ml-2"
                  loading={props.loading}
                  onClick={() => props.onObserve(defaultValue)}
                >
                  {text.observe}
                </Button>
              )}
          </div>
        </Col>
      </Row>

      <div className="mb-6">
        <Typography.Text type="secondary" className="d-block mb-2">
          {t('knowledge.headers')}
        </Typography.Text>
        <JsonCodeBlock
          code={headers}
          backgroundColor="var(--kailo-color-canvas)"
          maxHeight="400"
          copyable
        />
      </div>

      <div className="mb-6">
        <Typography.Text type="secondary" className="d-block mb-2">
          {t('knowledge.requestPayload')}
        </Typography.Text>
        <JsonCodeBlock
          code={requestPayload}
          backgroundColor="var(--kailo-color-canvas)"
          maxHeight="400"
          copyable
        />
      </div>

      <div className="mb-6">
        <Typography.Text type="secondary" className="d-block mb-2">
          {t('knowledge.responsePayload')}
        </Typography.Text>
        <JsonCodeBlock
          code={responsePayload}
          backgroundColor="var(--kailo-color-canvas)"
          maxHeight="400"
          copyable
        />
      </div>
    </Drawer>
  );
}
