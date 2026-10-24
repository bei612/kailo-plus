import { Form, Input, Switch } from 'antd';
import { ERROR_TEXTS } from '@/utils/error';
import { FORM_MODE } from '@/utils/enum';
import { hostValidator } from '@/utils/validator';
import { kailoT } from '@/utils/kailoI18n';

interface Props {
  mode?: FORM_MODE;
}

export default function TrinoProperties({ mode }: Props) {
  const isEditMode = mode === FORM_MODE.EDIT;
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
      <Form.Item
        label={kailoT('setup.fieldHost')}
        name="host"
        required
        rules={[
          {
            required: true,
            validator: hostValidator,
          },
        ]}
      >
        <Input placeholder="10.1.1.1" disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldPort')}
        name="port"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.PORT.REQUIRED,
          },
        ]}
      >
        <Input disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldSchemas')}
        name="schemas"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.SCHEMAS.REQUIRED,
          },
        ]}
      >
        <Input placeholder="catalog.schema1, catalog.schema2" />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldUsername')}
        name="username"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.USERNAME.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldPassword')}
        name="password"
        required
        rules={[
          {
            required: false,
            message: ERROR_TEXTS.CONNECTION.PASSWORD.REQUIRED,
          },
        ]}
      >
        <Input.Password placeholder={kailoT('setup.phPassword')} />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldUseSsl')}
        name="ssl"
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>
    </>
  );
}
