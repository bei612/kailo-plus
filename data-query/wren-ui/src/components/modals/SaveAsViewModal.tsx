import { Button, Form, Input, Modal, Typography } from 'antd';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import { ModalAction } from '@/hooks/useModalAction';
import { createViewNameValidator } from '@/utils/validator';
import SQLCodeBlock from '@/components/code/SQLCodeBlock';
import { useValidateViewMutation } from '@/apollo/client/graphql/view.generated';
import useKailoText from '@/utils/kailoI18n';

const { Text } = Typography;

type Props = ModalAction<{ sql: string }> & {
  loading?: boolean;
  defaultValue: { sql: string; responseId: number };
  payload: { rephrasedQuestion: string };
};

export default function SaveAsViewModal(props: Props) {
  const { visible, loading, onSubmit, onClose, defaultValue, payload } = props;
  const [form] = Form.useForm();
  const t = useKailoText();
  const [validateViewMutation] = useValidateViewMutation({
    fetchPolicy: 'no-cache',
  });

  const submit = () => {
    form
      .validateFields()
      .then(async (values) => {
        await onSubmit({
          responseId: defaultValue.responseId,
          ...payload,
          ...values,
        });
        onClose();
      })
      .catch(console.error);
  };

  const sql = defaultValue ? defaultValue.sql : '';

  return (
    <Modal
      title={t('home.saveAsView')}
      centered
      closable
      destroyOnClose
      onCancel={onClose}
      maskClosable={false}
      visible={visible}
      width={640}
      afterClose={() => form.resetFields()}
      footer={
        <div className="d-flex justify-space-between align-center">
          <div
            className="d-flex justify-space-between align-center ml-2"
            style={{ width: 300 }}
          >
            <InfoCircleOutlined className="mr-2 text-sm gray-7" />
            <Text type="secondary" className="text-sm gray-7 text-left">
              {t('home.saveAsViewHint')}
            </Text>
          </div>
          <div>
            <Button onClick={onClose}>{t('cancel')}</Button>
            <Button type="primary" onClick={submit} loading={loading}>
              {t('home.save')}
            </Button>
          </div>
        </div>
      }
    >
      <Form form={form} preserve={false} layout="vertical">
        <Form.Item
          label={t('home.name')}
          name="name"
          required
          rules={[
            {
              required: true,
              validator: createViewNameValidator(validateViewMutation),
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item label={t('home.sqlStatement')}>
          <SQLCodeBlock code={sql} showLineNumbers maxHeight="300" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
