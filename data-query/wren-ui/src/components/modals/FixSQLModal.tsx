import { useEffect, useMemo, useState } from 'react';
import { Button, Form, Modal, Typography, Alert } from 'antd';
import { ERROR_TEXTS } from '@/utils/error';
import { ModalAction } from '@/hooks/useModalAction';
import { attachLoading } from '@/utils/helper';
import { parseGraphQLError } from '@/utils/errorHandler';
import SQLEditor from '@/components/editor/SQLEditor';
import ErrorCollapse from '@/components/ErrorCollapse';
import PreviewData from '@/components/dataPreview/PreviewData';
import useGovernedSqlPreview from '@/hooks/useGovernedSqlPreview';
import { useRouter } from 'next/router';
import { getQueryPreviewText } from '@/utils/language';
import useKailoText from '@/utils/kailoI18n';

type Props = ModalAction<{ sql: string; responseId: number }> & {
  loading?: boolean;
};

export function FixSQLModal(props: Props) {
  const { visible, defaultValue, loading, onSubmit, onClose } = props;
  const [previewLoading, setPreviewLoading] = useState(false);
  const [form] = Form.useForm();

  // Handle errors via try/catch blocks rather than onError callback
  const sqlValue = Form.useWatch('sql', form);
  const query = useGovernedSqlPreview(sqlValue, visible);
  const previewSqlMutation = query.preview;
  const previewSqlResult = query.result;
  const text = getQueryPreviewText(useRouter().locale);
  const t = useKailoText();

  const error = useMemo(() => {
    if (!previewSqlResult.error) return null;
    const graphQLError = parseGraphQLError(previewSqlResult.error);
    return { ...graphQLError, shortMessage: t('home.invalidSql') };
  }, [previewSqlResult.error]);

  useEffect(() => {
    if (!visible) return;
    form.setFieldsValue(defaultValue || {});
  }, [form, defaultValue, visible]);

  const validateSql = async () => {
    const sql = form.getFieldValue('sql');
    return previewSqlMutation({
      variables: { data: { sql, limit: 1, dryRun: true } },
    });
  };

  const previewData = async () => {
    form
      .validateFields()
      .then(async (values) => {
        await attachLoading(
          previewSqlMutation,
          setPreviewLoading,
        )({
          variables: { data: { sql: values.sql, limit: 50 } },
        });
      })
      .catch(console.error);
  };

  const reset = () => {
    form.resetFields();
    previewSqlResult.reset();
  };

  const submit = async () => {
    form
      .validateFields()
      .then(async (values) => {
        if (!(await validateSql())) return;
        await onSubmit(values.sql);
        onClose();
      })
      .catch(console.error);
  };

  const showPreview = previewSqlResult.data || previewSqlResult.loading;

  return (
    <Modal
      title={t('home.fixSql')}
      width={640}
      visible={visible}
      okText={t('home.submit')}
      cancelText={t('cancel')}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={loading}
      maskClosable={false}
      destroyOnClose
      centered
      afterClose={reset}
    >
      <Typography.Text className="d-block gray-7 mb-3">
        {t('home.fixSqlIntro')}
      </Typography.Text>
      <Form form={form} preserve={false} layout="vertical">
        <Form.Item
          label={t('home.sqlStatement')}
          name="sql"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.FIX_SQL.SQL.REQUIRED,
            },
          ]}
        >
          <SQLEditor autoComplete autoFocus />
        </Form.Item>
      </Form>
      {query.scopeError ? (
        <Alert type="error" message={text.scopeError} />
      ) : null}
      {query.storageError ? (
        <Alert type="error" message={text.storageError} />
      ) : null}
      {query.state.pending ? (
        <Alert type="info" message={text.pending} />
      ) : null}
      {query.state.ended ? <Alert type="error" message={text.ended} /> : null}
      {query.state.denied ? (
        <Alert type="warning" message={text.denied} />
      ) : null}
      <div className="my-3">
        <Typography.Text className="d-block gray-7 mb-2">
          {t('home.dataPreview50')}
        </Typography.Text>
        <Button
          onClick={previewData}
          loading={previewLoading}
          disabled={previewLoading}
        >
          {t('home.previewData')}
        </Button>
        {showPreview && (
          <div className="my-3">
            <PreviewData
              loading={previewLoading}
              previewData={previewSqlResult?.data?.previewSql}
              copyable={false}
            />
          </div>
        )}
      </div>
      {!!error && (
        <Alert
          showIcon
          type="error"
          message={error.shortMessage}
          description={<ErrorCollapse message={error.message} />}
        />
      )}
    </Modal>
  );
}
