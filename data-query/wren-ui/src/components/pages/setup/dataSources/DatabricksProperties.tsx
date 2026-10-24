import { useEffect } from 'react';
import { Form, Input, Radio } from 'antd';
import { FORM_MODE, DATABRICKS_AUTH_METHOD } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import { hostValidator } from '@/utils/validator';
import { kailoT } from '@/utils/kailoI18n';

interface Props {
  mode?: FORM_MODE;
}

export default function DatabricksProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;

  const form = Form.useFormInstance();
  const databricksType = Form.useWatch(
    'databricksType',
    form,
  ) as DATABRICKS_AUTH_METHOD;

  useEffect(() => {
    if (!isEditMode) {
      form.setFieldsValue({
        databricksType: DATABRICKS_AUTH_METHOD.token,
      });
    }
  }, [isEditMode, form]);

  return (
    <>
      <Form.Item
        label={kailoT('setup.fieldDisplayName')}
        name="displayName"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.DISPLAY_NAME.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>
      <Form.Item label={kailoT('setup.fieldAuthMethod')} name="databricksType">
        <Radio.Group buttonStyle="solid">
          <Radio.Button value={DATABRICKS_AUTH_METHOD.token}>
            {kailoT('setup.authPat')}
          </Radio.Button>
          <Radio.Button value={DATABRICKS_AUTH_METHOD.service_principal}>
            {kailoT('setup.authServicePrincipal')}
          </Radio.Button>
        </Radio.Group>
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldServerHostname')}
        name="serverHostname"
        required
        rules={[
          {
            required: true,
            validator: hostValidator,
          },
        ]}
      >
        <Input
          placeholder={kailoT('setup.phDatabricksHost')}
          disabled={isEditMode}
        />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldHttpPath')}
        name="httpPath"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.HTTP_PATH.REQUIRED,
          },
        ]}
      >
        <Input
          placeholder={kailoT('setup.phHttpPath')}
          disabled={isEditMode}
        />
      </Form.Item>
      {databricksType === DATABRICKS_AUTH_METHOD.token && (
        <Form.Item
          label={kailoT('setup.fieldAccessToken')}
          name="accessToken"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.CONNECTION.PERSONAL_ACCESS_TOKEN.REQUIRED,
            },
          ]}
        >
          <Input.Password placeholder={kailoT('setup.phDatabricksToken')} />
        </Form.Item>
      )}
      {databricksType === DATABRICKS_AUTH_METHOD.service_principal && (
        <>
          <Form.Item
            label={kailoT('setup.fieldClientId')}
            name="clientId"
            required
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.CONNECTION.CLIENT_ID.REQUIRED,
              },
            ]}
          >
            <Input placeholder={kailoT('setup.phClientId')} />
          </Form.Item>
          <Form.Item
            label={kailoT('setup.fieldClientSecret')}
            name="clientSecret"
            required
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.CONNECTION.CLIENT_SECRET.REQUIRED,
              },
            ]}
          >
            <Input.Password placeholder={kailoT('setup.phClientSecret')} />
          </Form.Item>
          <Form.Item
            label={kailoT('setup.fieldAzureTenantId')}
            name="azureTenantId"
          >
            <Input placeholder={kailoT('setup.phAzureTenant')} />
          </Form.Item>
        </>
      )}
    </>
  );
}
