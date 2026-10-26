import { useEffect, useRef } from 'react';
import { Form, Input, Radio } from 'antd';
import { FORM_MODE, REDSHIFT_AUTH_METHOD } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import { hostValidator } from '@/utils/validator';
import { kailoT } from '@/utils/kailoI18n';

interface Props {
  mode?: FORM_MODE;
}

function RedshiftPasswordFields(props: { isEditMode: boolean }) {
  const { isEditMode } = props;
  return (
    <>
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
        <Input
          placeholder="mycluster.cmeaswqeuae.us-east-2.redshift.amazonaws.com"
          disabled={isEditMode}
        />
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
        <Input placeholder="5439" />
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
        label={kailoT('setup.fieldDatabase')}
        name="database"
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
    </>
  );
}

function RedshiftIAMFields(props: { isEditMode: boolean }) {
  const { isEditMode } = props;
  return (
    <>
      <Form.Item
        label={kailoT('setup.fieldClusterIdentifier')}
        name="clusterIdentifier"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.CLUSTER_IDENTIFIER.REQUIRED,
          },
        ]}
      >
        <Input placeholder="redshift-cluster-1" disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldUsername')}
        name="user"
        extra={kailoT('setup.hintRedshiftUser')}
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
        label={kailoT('setup.fieldDatabase')}
        name="database"
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

export default function RedshiftProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;

  const initialRedshiftTypeRef = useRef<REDSHIFT_AUTH_METHOD | null>(null);

  const form = Form.useFormInstance();
  const redshiftType = Form.useWatch(
    'redshiftType',
    form,
  ) as REDSHIFT_AUTH_METHOD;

  useEffect(() => {
    if (!isEditMode) {
      form.setFieldsValue({
        redshiftType: REDSHIFT_AUTH_METHOD.redshift,
      });
    }
  }, [isEditMode, form]);

  useEffect(() => {
    if (isEditMode && redshiftType && initialRedshiftTypeRef.current === null) {
      initialRedshiftTypeRef.current = redshiftType;
    }
  }, [isEditMode, redshiftType]);

  const getIsEditModeForComponent = (componentType: REDSHIFT_AUTH_METHOD) => {
    if (!isEditMode) return false;

    const initialType = initialRedshiftTypeRef.current || redshiftType;
    return initialType === componentType;
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
      <Form.Item label={kailoT('setup.fieldAuthMethod')} name="redshiftType">
        <Radio.Group buttonStyle="solid">
          <Radio.Button value={REDSHIFT_AUTH_METHOD.redshift}>
            {kailoT('setup.authUsernamePassword')}
          </Radio.Button>
          <Radio.Button value={REDSHIFT_AUTH_METHOD.redshift_iam}>
            {kailoT('setup.authAwsCredentials')}
          </Radio.Button>
        </Radio.Group>
      </Form.Item>
      {redshiftType === REDSHIFT_AUTH_METHOD.redshift && (
        <RedshiftPasswordFields
          isEditMode={getIsEditModeForComponent(REDSHIFT_AUTH_METHOD.redshift)}
        />
      )}
      {redshiftType === REDSHIFT_AUTH_METHOD.redshift_iam && (
        <RedshiftIAMFields
          isEditMode={getIsEditModeForComponent(
            REDSHIFT_AUTH_METHOD.redshift_iam,
          )}
        />
      )}
    </>
  );
}
