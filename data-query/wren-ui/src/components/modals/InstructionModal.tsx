import { useEffect } from 'react';
import { Button, Form, Input, Modal, Row, Col, Radio } from 'antd';
import { PlusIcon, TrashIcon } from '@/components/kailo/KailoIcons';
import useKailoText from '@/utils/kailoI18n';
import { isEmpty } from 'lodash';
import { FORM_MODE } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import { ModalAction } from '@/hooks/useModalAction';
import { Instruction } from '@/apollo/client/graphql/__types__';

const MAX_QUESTIONS = 100;

type Props = ModalAction<Instruction> & {
  loading?: boolean;
};

export default function InstructionModal(props: Props) {
  const { defaultValue, formMode, loading, onClose, onSubmit, visible } = props;

  const isCreateMode = formMode === FORM_MODE.CREATE;
  const t = useKailoText();

  const [form] = Form.useForm();
  const isDefault = Form.useWatch('isDefault', form);

  useEffect(() => {
    if (visible) {
      form.setFieldsValue({
        isDefault: isEmpty(defaultValue) ? true : defaultValue.isDefault,
        instruction: defaultValue?.instruction,
        questions: defaultValue?.questions,
      });
    }
  }, [visible, defaultValue]);

  const onSubmitButton = () => {
    form
      .validateFields()
      .then(async (values) => {
        const data = {
          isDefault: values.isDefault,
          instruction: values.instruction,
          questions: values?.questions || [],
        };
        await onSubmit({ data, id: defaultValue?.id });
        onClose();
      })
      .catch(console.error);
  };

  return (
    <Modal
      title={t(isCreateMode ? 'addInstruction' : 'knowledge.editInstruction')}
      centered
      closable
      confirmLoading={loading}
      destroyOnClose
      maskClosable={false}
      onCancel={onClose}
      visible={visible}
      width={640}
      cancelButtonProps={{ disabled: loading }}
      okText={t('knowledge.submit')}
      cancelText={t('cancel')}
      onOk={onSubmitButton}
      afterClose={() => form.resetFields()}
    >
      <Form form={form} preserve={false} layout="vertical">
        <Form.Item
          label={t('knowledge.instructionDetails')}
          name="instruction"
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.INSTRUCTION.DETAILS.REQUIRED,
            },
          ]}
        >
          <Input.TextArea
            autoFocus
            placeholder={t('knowledge.instructionPlaceholder')}
            maxLength={1000}
            rows={3}
            showCount
          />
        </Form.Item>
        <Form.Item
          label={t('knowledge.applyInstructionTo')}
          name="isDefault"
          required={false}
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.INSTRUCTION.IS_DEFAULT_GLOBAL.REQUIRED,
            },
          ]}
          extra={t('knowledge.applyInstructionHint')}
        >
          <Radio.Group>
            <Radio.Button value={true}>
              {t('knowledge.applyGlobal')}
            </Radio.Button>
            <Radio.Button value={false}>
              {t('knowledge.applyMatched')}
            </Radio.Button>
          </Radio.Group>
        </Form.Item>
        {!isDefault && (
          <Form.Item
            label={t('knowledge.matchingQuestions')}
            required
            extra={t('knowledge.matchingQuestionsHint')}
          >
            <Form.List name="questions" initialValue={['']}>
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Row key={key} wrap={false} gutter={8} className="my-2">
                      <Col flex="1 0">
                        <Form.Item
                          {...restField}
                          name={name}
                          required
                          className="mb-2"
                          style={{ width: '100%' }}
                          rules={[
                            {
                              required: true,
                              whitespace: true,
                              message:
                                ERROR_TEXTS.INSTRUCTION.QUESTIONS.REQUIRED,
                            },
                          ]}
                        >
                          <Input
                            placeholder={t(
                              'knowledge.matchingQuestionPlaceholder',
                            )}
                            maxLength={100}
                            showCount
                          />
                        </Form.Item>
                      </Col>
                      <Col flex="none" className="p-1">
                        <Button
                          onClick={() => remove(name)}
                          disabled={fields.length <= 1}
                          icon={<TrashIcon />}
                          type="text"
                          size="small"
                          aria-label={t('delete')}
                        />
                      </Col>
                    </Row>
                  ))}
                  <Form.Item noStyle>
                    <Button
                      type="dashed"
                      onClick={() => add()}
                      block
                      icon={<PlusIcon className="mr-1" />}
                      disabled={fields.length >= MAX_QUESTIONS}
                      className="mb-1"
                    >
                      {t('knowledge.addQuestion')}
                    </Button>
                  </Form.Item>
                </>
              )}
            </Form.List>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
