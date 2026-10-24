import { Button, Col, Form, Row, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ERROR_TEXTS } from '@/utils/error';
import MultiSelectBox from '@/components/table/MultiSelectBox';
import { CompactTable } from '@/apollo/client/graphql/__types__';
import useKailoText, { kailoT } from '@/utils/kailoI18n';
import useKailoSession from '@/hooks/useKailoSession';

const { Title, Text } = Typography;

interface Props {
  fetching: boolean;
  tables: CompactTable[];
  onNext: (data: { selectedTables: string[] }) => void;
  onBack: () => void;
  submitting: boolean;
}

const getColumns = (): ColumnsType<CompactTable> => [
  {
    title: kailoT('setup.tableName'),
    dataIndex: 'name',
  },
];

export default function SelectModels(props: Props) {
  const { fetching, tables, onBack, onNext, submitting } = props;
  const [form] = Form.useForm();
  const t = useKailoText();
  const { hostPage } = useKailoSession();
  const columns = getColumns();

  const items = tables.map((item) => ({
    ...item,
    value: item.name,
  }));

  const submit = () => {
    form
      .validateFields()
      .then((values) => {
        onNext && onNext({ selectedTables: values.tables });
      })
      .catch((error) => {
        console.error(error);
      });
  };

  return (
    <div>
      {!hostPage && (
        <Title level={2} className="mb-3">
          {t('setup.selectTablesTitle')}
        </Title>
      )}
      <Text type="secondary">{t('setup.selectTablesHint')}</Text>
      <div className="my-6">
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            name="tables"
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.SETUP_MODEL.TABLE.REQUIRED,
              },
            ]}
          >
            <MultiSelectBox
              columns={columns}
              items={items}
              loading={fetching}
            />
          </Form.Item>
        </Form>
      </div>
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
            className="adm-onboarding-btn"
            loading={submitting}
          >
            {t('setup.next')}
          </Button>
        </Col>
      </Row>
    </div>
  );
}
