import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { Alert, Button, Form, Input, Modal, Typography, message } from 'antd';
import { Logo } from '@/components/Logo';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import SelectOutlined from '@ant-design/icons/SelectOutlined';
import { ERROR_TEXTS } from '@/utils/error';
import { FORM_MODE } from '@/utils/enum';
import { getDataSourceName } from '@/utils/dataSourceType';
import useModalAction, { ModalAction } from '@/hooks/useModalAction';
import SQLEditor from '@/components/editor/SQLEditor';
import {
  parseGraphQLError,
  runNativeMetadataWrite,
} from '@/utils/errorHandler';
import { createSQLPairQuestionValidator } from '@/utils/validator';
import ErrorCollapse from '@/components/ErrorCollapse';
import PreviewData from '@/components/dataPreview/PreviewData';
import ImportDataSourceSQLModal, {
  isSupportSubstitute,
} from '@/components/modals/ImportDataSourceSQLModal';
import useGovernedSqlPreview from '@/hooks/useGovernedSqlPreview';
import { useRouter } from 'next/router';
import { getNativeWriteText, getQueryPreviewText } from '@/utils/language';
import { getUserConfig } from '@/utils/env';
import { useGetSettingsQuery } from '@/apollo/client/graphql/settings.generated';
import { useGenerateQuestionMutation } from '@/apollo/client/graphql/sql.generated';
import { SqlPair } from '@/apollo/client/graphql/__types__';
import { useSqlPairsLazyQuery } from '@/apollo/client/graphql/sqlPairs.generated';

type Props = Omit<ModalAction<SqlPair>, 'onSubmit'> & {
  onSubmit?: (values: any) => Promise<any>;
  loading?: boolean;
  payload?: {
    isCreateMode: boolean;
  };
};

const StyledForm = styled(Form)`
  .adm-question-form-item > div > label {
    width: 100%;
  }
`;

const Toolbar = (props: { dataSource: string; onClick: () => void }) => {
  const { dataSource, onClick } = props;
  const name = getDataSourceName(dataSource);
  return (
    <div className="d-flex justify-space-between align-center px-1">
      <span className="d-flex align-center gx-2">
        <Logo size={16} />
        Wren SQL
      </span>
      <Button className="px-0" type="link" size="small" onClick={onClick}>
        <SelectOutlined />
        Import from {name} SQL
      </Button>
    </div>
  );
};

export default function QuestionSQLPairModal(props: Props) {
  const {
    defaultValue,
    formMode,
    loading,
    onClose,
    onSubmit,
    visible,
    payload,
  } = props;

  // pass payload?.isCreateMode to prevent formMode from being set to Update when passing defaultValue, for the 'Add a SQL pair from an existing answer' scenario use.
  const isCreateMode = formMode === FORM_MODE.CREATE || payload?.isCreateMode;
  const importDataSourceSQLModal = useModalAction();

  const { data: settingsResult } = useGetSettingsQuery();
  const settings = settingsResult?.settings;
  const dataSource = useMemo(
    () => ({
      isSupportSubstitute: isSupportSubstitute(settings?.dataSource),
      type: settings?.dataSource?.type,
    }),
    [settings?.dataSource],
  );

  const [form] = Form.useForm();
  const [error, setError] =
    useState<ReturnType<typeof parseGraphQLError>>(null);
  const [previewing, setPreviewing] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [generatingQuestion, setGeneratingQuestion] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const writing = useRef(false);
  const [writeUnknown, setWriteUnknown] = useState(false);
  const [readSqlPairs] = useSqlPairsLazyQuery({ fetchPolicy: 'network-only' });

  // Handle errors via try/catch blocks rather than onError callback
  const [generateQuestionMutation] = useGenerateQuestionMutation({
    onError: (error) => console.error(error),
  });

  const sqlValue = Form.useWatch('sql', form);
  const query = useGovernedSqlPreview(sqlValue, visible);
  const previewSqlMutation = query.preview;
  const previewSqlResult = query.result;
  const locale = useRouter().locale;
  const text = getQueryPreviewText(locale);
  const writeText = getNativeWriteText(locale);

  useEffect(() => {
    if (visible) {
      form.setFieldsValue({
        question: defaultValue?.question,
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
    setError({
      ...graphQLError,
      shortMessage:
        graphQLError?.code === 'INVALID_SQL_ERROR'
          ? 'Invalid SQL syntax'
          : graphQLError?.shortMessage || text.unknown,
    });
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
      handleError(error);
    } finally {
      setPreviewing(false);
    }
  };

  const onSubmitButton = () => {
    if (writing.current) return;
    writing.current = true;
    setError(null);
    setSubmitting(true);
    setShowPreview(false);
    return form
      .validateFields()
      .then(async (values) => {
        let validation: ReturnType<typeof query.validatedSql>;
        try {
          await runNativeMetadataWrite({
            nativeType: 'sqlPair',
            mutationField: isCreateMode ? 'createSqlPair' : 'updateSqlPair',
            locale,
            variables: {
              data: values,
              ...(isCreateMode ? {} : { id: defaultValue?.id }),
            },
            beforeSubmit: async () => {
              if (!(await onValidateSQL()))
                throw new Error('QUERY_EVIDENCE_UNAVAILABLE');
              const config = await getUserConfig();
              if (config.nativeBindingConfigured === false) return;
              validation = query.validatedSql();
              if (!validation) throw new Error('QUERY_EVIDENCE_UNAVAILABLE');
              if (
                config.nativeBindingConfigured !== true ||
                config.queryScope !== validation.idempotencyScope
              )
                throw new Error('QUERY_IDENTITY_CHANGED');
            },
            submit: async (input, nativeWriteGuarded) =>
              onSubmit({
                ...input,
                data: { ...input.data, ...validation },
                nativeWriteGuarded,
              }),
            observe: async (nativeId) => {
              const current = await readSqlPairs();
              if (current.error) throw current.error;
              const pair = current.data?.sqlPairs?.find(
                (pair) => pair?.id === nativeId,
              );
              if (
                !pair ||
                pair.nativeWritePending ||
                pair.sql !== values.sql ||
                pair.question !== values.question
              )
                throw new Error('NATIVE_EXECUTION_UNKNOWN');
              return pair;
            },
          });
          setWriteUnknown(false);
          message.success(
            isCreateMode
              ? 'Successfully created question-sql pair.'
              : 'Successfully updated question-sql pair.',
          );
          onClose();
        } catch (error) {
          if (error?.message === 'NATIVE_EXECUTION_UNKNOWN') {
            setWriteUnknown(true);
            setError(null);
          } else handleError(error);
        } finally {
          writing.current = false;
          setSubmitting(false);
        }
      })
      .catch((err) => {
        writing.current = false;
        setSubmitting(false);
        console.error(err);
      });
  };

  const onGenerateQuestion = async () => {
    setGeneratingQuestion(true);
    const { data } = await generateQuestionMutation({
      variables: {
        data: {
          sql: sqlValue,
        },
      },
    });

    form.setFieldsValue({ question: data?.generateQuestion || '' });
    setGeneratingQuestion(false);
  };

  const confirmLoading = loading || submitting;
  const disabled = !sqlValue;

  return (
    <>
      <Modal
        title={`${isCreateMode ? 'Add' : 'Update'} question-SQL pair`}
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
              className="text-sm ml-2 d-flex justify-space-between align-center"
              style={{ width: 300 }}
            >
              <InfoCircleOutlined className="mr-2 text-sm gray-7" />
              <Typography.Text
                type="secondary"
                className="text-sm gray-7 text-left"
              >
                The SQL statement used here follows <b>Wren SQL</b>, which is
                based on ANSI SQL and optimized for Wren AI.{` `}
                <Typography.Link
                  type="secondary"
                  href="https://docs.getwren.ai/oss/guide/home/wren_sql"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Learn more about the syntax.
                </Typography.Link>
              </Typography.Text>
            </div>
            <div>
              <Button onClick={onClose}>Cancel</Button>
              <Button
                type="primary"
                onClick={onSubmitButton}
                loading={confirmLoading}
                disabled={previewSqlResult.loading}
              >
                Submit
              </Button>
            </div>
          </div>
        }
      >
        <StyledForm form={form} preserve={false} layout="vertical">
          <Form.Item
            className="adm-question-form-item"
            label={
              <div
                className="d-flex justify-space-between"
                style={{ width: '100%' }}
              >
                <span>Question</span>
                <div className="gray-8 text-sm">
                  Let AI create a matching question for this SQL statement.
                  <Button
                    className="ml-2"
                    size="small"
                    loading={generatingQuestion}
                    onClick={onGenerateQuestion}
                    disabled={disabled}
                  >
                    <span className="text-sm">Generate question</span>
                  </Button>
                </div>
              </div>
            }
            name="question"
            required
            rules={[
              {
                validator: createSQLPairQuestionValidator(
                  ERROR_TEXTS.SQL_PAIR.QUESTION,
                ),
              },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="SQL statement"
            name="sql"
            required
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.SQL_PAIR.SQL.REQUIRED,
              },
            ]}
          >
            <SQLEditor
              toolbar={
                dataSource.isSupportSubstitute && (
                  <Toolbar
                    dataSource={dataSource.type}
                    onClick={() =>
                      importDataSourceSQLModal.openModal({
                        dataSource: dataSource.type,
                      })
                    }
                  />
                )
              }
              autoComplete
              autoFocus
            />
          </Form.Item>
        </StyledForm>
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
            Data preview (50 rows)
          </Typography.Text>
          <Button
            onClick={onPreviewData}
            loading={previewing}
            disabled={disabled}
          >
            Preview data
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
        {writeUnknown && <Alert type="warning" message={writeText.unknown} />}
      </Modal>
      {dataSource.isSupportSubstitute && (
        <ImportDataSourceSQLModal
          {...importDataSourceSQLModal.state}
          onClose={importDataSourceSQLModal.closeModal}
          onSubmit={async (convertedSql: string) => {
            form.setFieldsValue({ sql: convertedSql });
          }}
        />
      )}
    </>
  );
}
