import { Button, Modal, Select, Row, Col, Form, message } from 'antd';
import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';
import {
  useResetCurrentProjectMutation,
  useUpdateCurrentProjectMutation,
} from '@/apollo/client/graphql/settings.generated';
import { getLanguageText } from '@/utils/language';
import { ProjectLanguage } from '@/apollo/client/graphql/__types__';
import useKailoText from '@/utils/kailoI18n';

interface Props {
  data: { language: string };
}

export default function ProjectSettings(props: Props) {
  const { data } = props;
  const router = useRouter();
  const t = useKailoText();
  const [form] = Form.useForm();
  const [resetCurrentProject, { client }] = useResetCurrentProjectMutation({
    onError: (error) => console.error(error),
  });
  const languageOptions = Object.keys(ProjectLanguage).map((key) => {
    return { label: getLanguageText(key as ProjectLanguage), value: key };
  });

  const [updateCurrentProject, { loading }] = useUpdateCurrentProjectMutation({
    refetchQueries: ['GetSettings'],
    onError: (error) => console.error(error),
    onCompleted: () => {
      message.success(t('languageUpdated'));
    },
  });

  const reset = () => {
    Modal.confirm({
      title: t('resetConfirm'),
      okButtonProps: { danger: true },
      okText: t('reset'),
      onOk: async () => {
        await resetCurrentProject();
        client.clearStore();
        router.push(Path.OnboardingConnection);
      },
    });
  };

  const submit = () => {
    form
      .validateFields()
      .then((values) => {
        updateCurrentProject({ variables: { data: values } });
      })
      .catch((error) => console.error(error));
  };

  return (
    <div className="py-3 px-4">
      <Form
        form={form}
        layout="vertical"
        initialValues={{ language: data.language }}
      >
        <Form.Item
          label={t('projectLanguage')}
          extra={t('projectLanguageHint')}
        >
          <Row gutter={16} wrap={false}>
            <Col className="flex-grow-1">
              <Form.Item name="language" noStyle>
                <Select
                  placeholder={t('selectLanguage')}
                  showSearch
                  options={languageOptions}
                />
              </Form.Item>
            </Col>
            <Col>
              <Button
                type="primary"
                style={{ width: 70 }}
                onClick={submit}
                loading={loading}
              >
                {t('save')}
              </Button>
            </Col>
          </Row>
        </Form.Item>
      </Form>
      <div className="gray-8 mb-2">{t('resetProject')}</div>
      <Button type="primary" style={{ width: 70 }} danger onClick={reset}>
        {t('reset')}
      </Button>
      <div className="gray-6 mt-1">{t('resetHint')}</div>
    </div>
  );
}
