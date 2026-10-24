import { Button, Select, Row, Col, Form, Typography } from 'antd';
import { confirm, notify } from '@/utils/kailoHost';
import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';
import {
  useResetCurrentProjectMutation,
  useUpdateCurrentProjectMutation,
} from '@/apollo/client/graphql/settings.generated';
import { getLanguageText } from '@/utils/language';
import { ProjectLanguage } from '@/apollo/client/graphql/__types__';
import useKailoText from '@/utils/kailoI18n';
import { SECTION_TITLE } from './utils';

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
      notify.success(t('languageUpdated'));
    },
  });

  // DD-157 (20 §13.8): irreversible, so Kailo's danger confirmation.
  const reset = async () => {
    const confirmed = await confirm({
      tone: 'danger',
      title: t('resetConfirm'),
      description: t('resetHint'),
      confirmLabel: t('reset'),
      cancelLabel: t('cancel'),
    });
    if (!confirmed) return;
    await resetCurrentProject();
    client.clearStore();
    router.push(Path.OnboardingConnection);
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
              <Button type="primary" onClick={submit} loading={loading}>
                {t('save')}
              </Button>
            </Col>
          </Row>
        </Form.Item>
      </Form>
      <div style={SECTION_TITLE} className="mb-2">
        {t('resetProject')}
      </div>
      <Typography.Paragraph type="secondary" className="mb-3">
        {t('resetHint')}
      </Typography.Paragraph>
      <Button danger onClick={reset}>
        {t('reset')}
      </Button>
    </div>
  );
}
