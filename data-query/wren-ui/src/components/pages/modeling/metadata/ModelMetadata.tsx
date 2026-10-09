import { useMemo } from 'react';
import { keyBy } from 'lodash';
import { Alert, Col, Row, Typography, Button } from 'antd';
import FieldTable from '@/components/table/FieldTable';
import CalculatedFieldTable from '@/components/table/CalculatedFieldTable';
import RelationTable from '@/components/table/RelationTable';
import PreviewData from '@/components/dataPreview/PreviewData';
import { DiagramModel } from '@/utils/data';
import { usePreviewModelDataMutation } from '@/apollo/client/graphql/model.generated';
import useGovernedPreview from '@/hooks/useGovernedPreview';
import { useRouter } from 'next/router';
import { getQueryPreviewText } from '@/utils/language';

export type Props = DiagramModel;

export default function ModelMetadata(props: Props) {
  const text = getQueryPreviewText(useRouter().locale);
  const {
    modelId,
    displayName,
    referenceName,
    fields = [],
    calculatedFields = [],
    relationFields = [],
    description,
  } = props || {};

  const [previewModelData, previewModelDataResult] =
    usePreviewModelDataMutation({
      onError: (error) => console.error(error),
    });
  const query = useGovernedPreview(
    'model',
    modelId,
    async (where) => {
      const result = await previewModelData({ variables: { where } });
      return result.data?.previewModelData;
    },
    previewModelDataResult.data?.previewModelData,
    previewModelDataResult.error,
  );

  // Model preview data should show alias as column name.
  const fieldsMap = useMemo(() => keyBy(fields, 'referenceName'), [fields]);
  const previewData = useMemo(() => {
    if (!query.completed) return undefined;
    const previewModelData = query.data;
    const columns = (previewModelData?.columns || []).map((column) => {
      const alias = fieldsMap[column.name]?.displayName;
      return { ...column, name: alias || column.name };
    });
    return { ...previewModelData, columns };
  }, [fieldsMap, query.data, query.completed]);

  return (
    <>
      <Row className="mb-6">
        <Col span={12} data-testid="metadata__name">
          <Typography.Text className="d-block gray-7 mb-2">
            Name
          </Typography.Text>
          <div>{referenceName || '-'}</div>
        </Col>
        <Col span={12} data-testid="metadata__alias">
          <Typography.Text className="d-block gray-7 mb-2">
            Alias
          </Typography.Text>
          <div>{displayName || '-'}</div>
        </Col>
      </Row>
      <div className="mb-6" data-testid="metadata__description">
        <Typography.Text className="d-block gray-7 mb-2">
          Description
        </Typography.Text>
        <div>{description || '-'}</div>
      </div>

      <div className="mb-6" data-testid="metadata__columns">
        <Typography.Text className="d-block gray-7 mb-2">
          Columns ({fields.length})
        </Typography.Text>
        <FieldTable dataSource={fields} showExpandable />
      </div>

      {!!calculatedFields.length && (
        <div className="mb-6" data-testid="metadata__calculated-fields">
          <Typography.Text className="d-block gray-7 mb-2">
            Calculated fields ({calculatedFields.length})
          </Typography.Text>
          <CalculatedFieldTable dataSource={calculatedFields} showExpandable />
        </div>
      )}

      {!!relationFields.length && (
        <div className="mb-6" data-testid="metadata__relationships">
          <Typography.Text className="d-block gray-7 mb-2">
            Relationships ({relationFields.length})
          </Typography.Text>
          <RelationTable dataSource={relationFields} showExpandable />
        </div>
      )}

      <div className="mb-6" data-testid="metadata__preview-data">
        <Typography.Text className="d-block gray-7 mb-2">
          Data preview (100 rows)
        </Typography.Text>
        <Button
          onClick={query.preview}
          loading={previewModelDataResult.loading || query.preparing}
        >
          {query.pending || (query.governed && query.error)
            ? text.check
            : text.preview}
        </Button>
        {query.storageError ? (
          <Alert type="error" message={text.storageError} />
        ) : null}
        {query.scopeError ? (
          <Alert type="error" message={text.scopeError} />
        ) : null}
        {query.pending ? <Alert type="info" message={text.pending} /> : null}
        {query.ended ? <Alert type="error" message={text.ended} /> : null}
        {query.denied ? <Alert type="warning" message={text.denied} /> : null}
        <div className="my-3">
          <PreviewData
            error={query.error}
            loading={previewModelDataResult.loading}
            previewData={previewData}
          />
        </div>
      </div>
    </>
  );
}
