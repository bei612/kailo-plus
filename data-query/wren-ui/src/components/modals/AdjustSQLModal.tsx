import { useEffect, useState } from 'react';
import { Alert, Button, Form, Modal, Typography } from 'antd';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import { ERROR_TEXTS } from '@/utils/error';
import { ModalAction } from '@/hooks/useModalAction';
import SQLEditor from '@/components/editor/SQLEditor';
import { parseGraphQLError } from '@/utils/errorHandler';
import ErrorCollapse from '@/components/ErrorCollapse';
import PreviewData from '@/components/dataPreview/PreviewData';
import useGovernedSqlPreview from '@/hooks/useGovernedSqlPreview';
import { useRouter } from 'next/router';
import { getQueryPreviewText } from '@/utils/language';
import useKailoText from '@/utils/kailoI18n';

interface AdjustSQLFormValues {
  responseId: number;
  sql: string;
}

type Props = ModalAction<AdjustSQLFormValues, AdjustSQLFormValues> & {
  loading?: boolean;
};

export default function AdjustSQLModal(props: Props) {
  const { defaultValue, loading, onClose, onSubmit, visible } = props;

  const [form] = Form.useForm();
  const [error, setError] =
    useState<ReturnType<typeof parseGraphQLError>>(null);
  const [previewing, setPreviewing] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<boolean>(false);

  // Handle errors via try/catch blocks rather than onError callback
  const sqlValue = Form.useWatch('sql', form);
  const query = useGovernedSqlPreview(sqlValue, visible);
  const previewSqlMutation = query.preview;
  const previewSqlResult = query.result;
  const text = getQueryPreviewText(useRouter().locale);
  const t = useKailoText();

  useEffect(() => {
    if (visible) {
      form.setFieldsValue({
        sql: defaultValue?.sql,
      });
    }
  }, [visible, defaultValue]);

  const handleReset = () => {
    previewSqlResult.reset();
    setShowPreview(false);
    setError(null);
    form.resetFields();
  };

  const onValidateSQL = async () => {
    return previewSqlMutation({
      variables: {
        data: {
          sql: sqlValue,
          limit: 1,
          dryRun: true,
        },
      },
    });
  };

  const handleError = (error) => {
    const graphQLError = parseGraphQLError(error);
    setError({ ...graphQLError, shortMessage: t('home.invalidSql') });
    console.error(graphQLError);
  };

  const onPreviewData = async () => {
    setError(null);
    setPreviewing(true);
    try {
      if (!(await onValidateSQL())) return;
      setShowPreview(true);
      await previewSqlMutation({
        variables: {
          data: {
            sql: sqlValue,
            limit: 50,
          },
        },
      });
    } catch (error) {
      setShowPreview(false);
      handleError(error);
    } finally {
      setPreviewing(false);
    }
  };

  const onSubmitButton = () => {
    setError(null);
    setSubmitting(true);
    setShowPreview(false);
    form
      .validateFields()
      .then(async (values) => {
        try {
          if (!(await onValidateSQL())) return;
          await onSubmit({
            responseId: defaultValue?.responseId,
            sql: values.sql,
          });
          onClose();
        } catch (error) {
          handleError(error);
        } finally {
          setSubmitting(false);
        }
      })
      .catch((err) => {
        setSubmitting(false);
        console.error(err);
      });
  };

  const confirmLoading = loading || submitting;
  const disabled = !sqlValue;

  return (
    <Modal
      title={t('home.adjustSql')}
      centered
      closable
      confirmLoading={confirmLoading}
      destroyOnClose
      maskClosable={false}
      onCancel={onClose}
      visible={visible}
      width={640}
      cancelButtonProps={{ disabled: confirmLoading }}
      okButtonProps={{ disabled: previewSqlResult.loading }}
      afterClose={() => handleReset()}
      footer={
        <div className="d-flex justify-space-between align-center">
          <div
            className="text-sm ml-2 d-flex align-center"
            style={{ flex: 1, minWidth: 0, marginRight: 16 }}
          >
            <InfoCircleOutlined className="mr-2 text-sm gray-7" />
            <Typography.Text
              type="secondary"
              className="text-sm gray-7 text-left"
            >
              {t('home.semanticDialectHint')}
            </Typography.Text>
          </div>
          <div>
            <Button onClick={onClose}>{t('cancel')}</Button>
            <Button
              type="primary"
              onClick={onSubmitButton}
              loading={confirmLoading}
            >
              {t('home.submit')}
            </Button>
          </div>
        </div>
      }
    >
      <Form form={form} preserve={false} layout="vertical">
        <Form.Item
          label={t('home.sqlStatement')}
          name="sql"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.SQL_PAIR.SQL.REQUIRED,
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
          onClick={onPreviewData}
          loading={previewing}
          disabled={disabled}
        >
          {t('home.previewData')}
        </Button>
        {showPreview && (
          <div className="my-3">
            <PreviewData
              loading={previewing}
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
