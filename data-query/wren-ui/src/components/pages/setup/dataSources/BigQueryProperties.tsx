import { useEffect, useState } from 'react';
import { Form, Input, Button, Upload, UploadProps } from 'antd';
import { notify } from '@/utils/kailoHost';
import UploadOutlined from '@ant-design/icons/UploadOutlined';
import { ERROR_TEXTS } from '@/utils/error';
import { FORM_MODE } from '@/utils/enum';
import { readFileContent } from '@/utils/file';
import { kailoT } from '@/utils/kailoI18n';

interface Props {
  mode?: FORM_MODE;
}

const UploadCredentials = (props: {
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
        const parsedJson = JSON.parse(result);
        onChange && onChange(parsedJson);
        setFileList([uploadFile]);
      } catch (error) {
        console.error('Failed to handle file', error);
        notify.error(
          kailoT('setup.fileReadFailed'),
          kailoT('setup.uploadValidCredentials'),
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
      accept=".json"
      fileList={fileList}
      onChange={onUploadChange}
      onRemove={onRemove}
      maxCount={1}
    >
      <Button icon={<UploadOutlined />}>{kailoT('setup.uploadJsonKey')}</Button>
    </Upload>
  );
};

export default function BigQueryProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;

  return (
    <>
      <Form.Item
        label={kailoT('setup.fieldDisplayName')}
        required
        name="displayName"
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.DISPLAY_NAME.REQUIRED,
          },
        ]}
      >
        <Input placeholder={kailoT('setup.phBigQueryDisplayName')} />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldProjectId')}
        required
        name="projectId"
        rules={[
          {
            required: !isEditMode,
            message: ERROR_TEXTS.CONNECTION.PROJECT_ID.REQUIRED,
          },
        ]}
      >
        <Input
          placeholder={kailoT('setup.phGcpProjectId')}
          disabled={isEditMode}
        />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldDatasetId')}
        required
        name="datasetId"
        rules={[
          {
            required: !isEditMode,
            message: ERROR_TEXTS.CONNECTION.DATASET_ID.REQUIRED,
          },
        ]}
      >
        <Input disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldCredentials')}
        required={!isEditMode}
        name="credentials"
        rules={[
          {
            required: !isEditMode,
            message: ERROR_TEXTS.CONNECTION.CREDENTIAL.REQUIRED,
          },
        ]}
      >
        <UploadCredentials />
      </Form.Item>
    </>
  );
}
