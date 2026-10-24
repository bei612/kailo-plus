import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Form, Input, Radio, Upload, UploadProps } from 'antd';
import { notify } from '@/utils/kailoHost';
import UploadOutlined from '@ant-design/icons/UploadOutlined';
import { ERROR_TEXTS } from '@/utils/error';
import { FORM_MODE } from '@/utils/enum';
import { readFileContent, extractPrivateKeyString } from '@/utils/file';
import { kailoT } from '@/utils/kailoI18n';

const TAB_KEY = {
  PASSWORD_AUTHENTICATION: 'password_authentication',
  KEY_PAIR_AUTHENTICATION: 'key_pair_authentication',
};

interface Props {
  mode?: FORM_MODE;
}

const UploadPrivateKey = (props: {
  onChange?: (value: string) => void;
  value?: string;
}) => {
  const { onChange, value } = props;
  const [fileList, setFileList] = useState<UploadProps['fileList']>([]);

  useEffect(() => {
    if (!value) setFileList([]);
  }, [value]);

  const onUploadChange = async (info) => {
    const { file, fileList } = info;
    if (fileList.length) {
      const uploadFile = fileList[0];

      try {
        const result = await readFileContent(file.originFileObj);
        const extractedPrivateKey = extractPrivateKeyString(result);
        onChange && onChange(extractedPrivateKey);
        setFileList([uploadFile]);
      } catch (error) {
        console.error('Failed to handle file', error);
        notify.error(
          kailoT('setup.fileReadFailed'),
          kailoT('setup.uploadValidPrivateKey'),
        );
      }
    }
  };

  const onRemove = () => {
    setFileList([]);
    onChange && onChange(undefined);
  };

  return (
    <Upload
      accept=".pem,.key,.p8"
      fileList={fileList}
      onChange={onUploadChange}
      onRemove={onRemove}
      maxCount={1}
    >
      <Button icon={<UploadOutlined />}>
        {kailoT('setup.uploadPrivateKey')}
      </Button>
    </Upload>
  );
};

export default function SnowflakeProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;
  const [tabKey, setTabKey] = useState(TAB_KEY.PASSWORD_AUTHENTICATION);

  const changeTabKey = (e) => {
    setTabKey(e.target.value);
  };

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
        label={kailoT('setup.fieldAccount')}
        name="account"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.ACCOUNT.REQUIRED,
          },
        ]}
      >
        <Input
          placeholder="<snowflake_org_id>-<snowflake_user_id>"
          disabled={isEditMode}
        />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldDatabaseName')}
        name="database"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.DATABASE.REQUIRED,
          },
        ]}
      >
        <Input
          placeholder={kailoT('setup.phSnowflakeDatabase')}
          disabled={isEditMode}
        />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldSchema')}
        name="schema"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.SCHEMA.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldWarehouse')}
        name="warehouse"
        extra={<span className="gray-7">{kailoT('setup.hintWarehouse')}</span>}
      >
        <Input />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldUser')}
        name="user"
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.USER.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>
      <Form.Item
        label={
          <div>
            {kailoT('setup.fieldAuthMethod')}
            <div className="gray-7">
              {kailoT('setup.hintSnowflakePasswordDeprecated')}{' '}
              <Link
                className="gray-7 underline"
                href="https://www.snowflake.com/en/blog/blocking-single-factor-password-authentification"
                target="_blank"
                rel="noreferrer noopener"
              >
                {kailoT('setup.learnMore')}
              </Link>
            </div>
          </div>
        }
      >
        <Radio.Group value={tabKey} onChange={changeTabKey} buttonStyle="solid">
          <Radio.Button value={TAB_KEY.PASSWORD_AUTHENTICATION}>
            {kailoT('setup.authPassword')}
          </Radio.Button>
          <Radio.Button value={TAB_KEY.KEY_PAIR_AUTHENTICATION}>
            {kailoT('setup.authKeyPair')}
          </Radio.Button>
        </Radio.Group>
      </Form.Item>

      <div>
        {tabKey === TAB_KEY.PASSWORD_AUTHENTICATION && (
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
        )}
        {tabKey === TAB_KEY.KEY_PAIR_AUTHENTICATION && (
          <Form.Item
            label={kailoT('setup.fieldPrivateKeyFile')}
            name="privateKey"
            required
            rules={[
              {
                required: !isEditMode,
                message: ERROR_TEXTS.CONNECTION.PRIVATE_KEY_FILE.REQUIRED,
              },
            ]}
            extra={
              <div className="gray-7">{kailoT('setup.hintPrivateKey')}</div>
            }
          >
            <UploadPrivateKey />
          </Form.Item>
        )}
      </div>
    </>
  );
}
