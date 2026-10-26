import { useEffect, useRef } from 'react';
import { Form, Input, Radio } from 'antd';
import { FORM_MODE, ATHENA_AUTH_METHOD } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import { kailoT } from '@/utils/kailoI18n';

interface Props {
  mode?: FORM_MODE;
}

function AthenaClassicFields() {
  return (
    <>
      <Form.Item
        label={kailoT('setup.fieldAwsAccessKey')}
        name="awsAccessKey"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.AWS_ACCESS_KEY.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>

      <Form.Item
        label={kailoT('setup.fieldAwsSecretKey')}
        name="awsSecretKey"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.AWS_SECRET_KEY.REQUIRED,
          },
        ]}
      >
        <Input.Password />
      </Form.Item>
    </>
  );
}

function AthenaOIDCFields(props: { isEditMode: boolean }) {
  const { isEditMode } = props;

  return (
    <>
      <Form.Item
        label={kailoT('setup.fieldWebIdentityToken')}
        name="webIdentityToken"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.WEB_IDENTITY_TOKEN.REQUIRED,
          },
        ]}
      >
        <Input.Password
          placeholder={kailoT('setup.phWebIdentityToken')}
          autoComplete="off"
        />
      </Form.Item>

      <Form.Item
        label={kailoT('setup.fieldAwsRoleArn')}
        name="roleArn"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.AWS_ROLE_ARN.REQUIRED,
          },
        ]}
      >
        <Input
          placeholder="arn:aws:iam::<account-id>:role/<role-name>"
          disabled={isEditMode}
        />
      </Form.Item>

      <Form.Item
        label={kailoT('setup.fieldRoleSessionName')}
        name="roleSessionName"
        extra={kailoT('setup.hintRoleSessionName')}
      >
        <Input placeholder={kailoT('setup.phSessionName')} />
      </Form.Item>
    </>
  );
}

export default function AthenaProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;

  const form = Form.useFormInstance();

  const initialTypeRef = useRef<ATHENA_AUTH_METHOD | null>(null);

  const authType = Form.useWatch('athenaAuthType', form) as ATHENA_AUTH_METHOD;

  // Set default auth type when creating
  useEffect(() => {
    if (!isEditMode) {
      form.setFieldsValue({
        athenaAuthType: ATHENA_AUTH_METHOD.classic,
      });
    }
  }, [isEditMode, form]);

  // Preserve initial type on edit mode
  useEffect(() => {
    if (isEditMode && authType && initialTypeRef.current === null) {
      initialTypeRef.current = authType;
    }
  }, [isEditMode, authType]);

  const getIsEditModeForComponent = (component: ATHENA_AUTH_METHOD) => {
    if (!isEditMode) return false;
    const initial = initialTypeRef.current || authType;
    return initial === component;
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

      {/* Common fields */}
      <Form.Item
        label={kailoT('setup.fieldDatabaseSchema')}
        name="schema"
        extra={kailoT('setup.hintAthenaDatabase')}
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.DATABASE.REQUIRED,
          },
        ]}
      >
        <Input disabled={isEditMode} />
      </Form.Item>

      <Form.Item
        label={kailoT('setup.fieldS3StagingDir')}
        name="s3StagingDir"
        required
        extra={
          <>
            {kailoT('setup.hintS3StagingDir')}
            <br />
            {kailoT('setup.hintS3StagingDirWhere')}
          </>
        }
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.S3_STAGING_DIR.REQUIRED,
          },
        ]}
      >
        <Input placeholder="s3://bucket/path" />
      </Form.Item>

      <Form.Item
        label={kailoT('setup.fieldAwsRegion')}
        name="awsRegion"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.AWS_REGION.REQUIRED,
          },
        ]}
      >
        <Input placeholder="us-east-1" disabled={isEditMode} />
      </Form.Item>

      {/* Authentication method switch */}
      <Form.Item label={kailoT('setup.fieldAuthMethod')} name="athenaAuthType">
        <Radio.Group buttonStyle="solid">
          <Radio.Button value={ATHENA_AUTH_METHOD.classic}>
            {kailoT('setup.authAwsCredentials')}
          </Radio.Button>
          <Radio.Button value={ATHENA_AUTH_METHOD.oidc}>
            {kailoT('setup.authOidc')}
          </Radio.Button>
          <Radio.Button value={ATHENA_AUTH_METHOD.instance_profile}>
            {kailoT('setup.authInstanceProfile')}
          </Radio.Button>
        </Radio.Group>
      </Form.Item>

      {/* Conditional auth fields */}
      {authType === ATHENA_AUTH_METHOD.classic && <AthenaClassicFields />}

      {authType === ATHENA_AUTH_METHOD.oidc && (
        <AthenaOIDCFields
          isEditMode={getIsEditModeForComponent(ATHENA_AUTH_METHOD.oidc)}
        />
      )}

      {authType === ATHENA_AUTH_METHOD.instance_profile && (
        <div className="gray-7">{kailoT('setup.hintInstanceProfile')}</div>
      )}
    </>
  );
}
