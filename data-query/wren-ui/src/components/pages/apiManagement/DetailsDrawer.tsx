import { Drawer, Typography, Row, Col, Tag, Button } from 'antd';
import { useRouter } from 'next/router';
import { getAbsoluteTime } from '@/utils/time';
import { DrawerAction } from '@/hooks/useDrawerAction';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import CloseCircleOutlined from '@ant-design/icons/CloseCircleOutlined';
import JsonCodeBlock from '@/components/code/JsonCodeBlock';
import { ApiHistoryResponse, ApiType } from '@/apollo/client/graphql/__types__';
import { getApiHistoryText } from '@/utils/language';

type Props = DrawerAction<ApiHistoryResponse> & {
  loading?: boolean;
  onObserve?: (record: ApiHistoryResponse) => Promise<void>;
};

export default function DetailsDrawer(props: Props) {
  const { visible, onClose, defaultValue } = props;
  const text = getApiHistoryText(useRouter().locale);

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
      className="gray-8"
      title="API details"
      width={760}
      closable
      destroyOnClose
      onClose={onClose}
      footer={null}
    >
      <Row className="mb-6">
        <Col span={12}>
          <Typography.Text className="d-block gray-7 mb-2">
            API type
          </Typography.Text>
          <div>
            <Tag className="gray-8">{apiType?.toLowerCase()}</Tag>
          </div>
        </Col>
        <Col span={12}>
          <Typography.Text className="d-block gray-7 mb-2">
            Thread ID
          </Typography.Text>
          <div>{threadId || '-'}</div>
        </Col>
      </Row>
      <Row className="mb-6">
        <Col span={12}>
          <Typography.Text className="d-block gray-7 mb-2">
            Created at
          </Typography.Text>
          <div>{getAbsoluteTime(createdAt)}</div>
        </Col>
        <Col span={12}>
          <Typography.Text className="d-block gray-7 mb-2">
            Duration
          </Typography.Text>
          <div>{durationMs} ms</div>
        </Col>
      </Row>
      <Row className="mb-6">
        <Col span={12}>
          <Typography.Text className="d-block gray-7 mb-2">
            Status code
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
        <Typography.Text className="d-block gray-7 mb-2">
          Headers
        </Typography.Text>
        <JsonCodeBlock
          code={headers}
          backgroundColor="var(--gray-2)"
          maxHeight="400"
          copyable
        />
      </div>

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Request payload
        </Typography.Text>
        <JsonCodeBlock
          code={requestPayload}
          backgroundColor="var(--gray-2)"
          maxHeight="400"
          copyable
        />
      </div>

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Response payload
        </Typography.Text>
        <JsonCodeBlock
          code={responsePayload}
          backgroundColor="var(--gray-2)"
          maxHeight="400"
          copyable
        />
      </div>
    </Drawer>
  );
}
