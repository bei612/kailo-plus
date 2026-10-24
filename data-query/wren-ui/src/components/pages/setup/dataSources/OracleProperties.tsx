import { Form, Input } from 'antd';
import { ERROR_TEXTS } from '@/utils/error';
import { FORM_MODE } from '@/utils/enum';
import { hostValidator } from '@/utils/validator';
import { kailoT } from '@/utils/kailoI18n';

interface Props {
  mode?: FORM_MODE;
}

export default function OracleProperties(props: Props) {
  const { mode } = props;
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
        rules={[
          {
            required: false,
            validator: (_, value) => {
              if (value) {
                return hostValidator(_, value);
              }
              return Promise.resolve();
            },
          },
        ]}
      >
        <Input placeholder="10.1.1.1" disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldPort')}
        name="port"
        rules={[
          {
            message: ERROR_TEXTS.CONNECTION.PORT.REQUIRED,
          },
        ]}
      >
        <Input placeholder="1521" disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldUsername')}
        name="user"
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
            required: true,
            message: ERROR_TEXTS.CONNECTION.PASSWORD.REQUIRED,
          },
        ]}
      >
        <Input.Password placeholder={kailoT('setup.phPassword')} />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldDatabaseName')}
        name="database"
        rules={[
          {
            message: ERROR_TEXTS.CONNECTION.DATABASE.REQUIRED,
          },
        ]}
      >
        <Input
          placeholder={kailoT('setup.phOracleDatabase')}
          disabled={isEditMode}
        />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldDsn')}
        name="dsn"
        tooltip={kailoT('setup.tipOracleDsn')}
      >
        <Input placeholder="(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=host)(PORT=port))(CONNECT_DATA=(SERVICE_NAME=service)))" />
      </Form.Item>
    </>
  );
}
