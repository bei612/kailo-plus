import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, InputNumber, Typography } from 'antd';
import SQLCodeBlock from '@/components/code/SQLCodeBlock';
import PreviewData from '@/components/dataPreview/PreviewData';
import { COLUMN } from '@/components/table/BaseTable';
import FieldTable from '@/components/table/FieldTable';
import { DiagramView } from '@/utils/data';
import { usePreviewViewDataMutation } from '@/apollo/client/graphql/view.generated';
import { useRouter } from 'next/router';
import { getQueryPreviewText } from '@/utils/language';
import useGovernedPreview from '@/hooks/useGovernedPreview';

export type Props = DiagramView;

export default function ViewMetadata(props: Props) {
  const text = getQueryPreviewText(useRouter().locale);
  const {
    displayName,
    description,
    fields = [],
    statement,
    viewId,
  } = props || {};

  const [previewViewData, previewViewDataResult] = usePreviewViewDataMutation({
    onError: (error) => console.error(error),
  });

  const {
    preview: onPreviewData, preparing: queryPreparing, scopeError: queryScopeError,
    storageError: queryStorageError, receipt: queryReceipt, pending: queryPending,
    error: queryError,
  } = useGovernedPreview('view', viewId, async (where) => {
    const result = await previewViewData({ variables: { where } });
    return result.data?.previewViewData;
  }, previewViewDataResult.data?.previewViewData, previewViewDataResult.error);

  const [resourceId, setResourceId] = useState('');
  const [limit, setLimit] = useState<number | null>(null);
  const [reference, setReference] = useState('');
  const [referenceError, setReferenceError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const selection = useRef(0);
  useEffect(() => {
    selection.current++;
    setReference('');
    setReferenceError(false);
    setExporting(false);
    return () => {
      selection.current++;
    };
  }, [viewId]);
  const exportReference = async () => {
    const current = ++selection.current;
    setExporting(true);
    setReference('');
    setReferenceError(false);
    try {
      const query = new URLSearchParams({
        resourceId,
        viewId: String(viewId),
        limit: String(limit),
      });
      const response = await fetch(`/api/platform-query-reference?${query}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('reference unavailable');
      const value = await response.json();
      if (
        value.resourceId !== resourceId ||
        typeof value.nativeObjectRef !== 'string' ||
        typeof value.nativeRevision !== 'string'
      )
        throw new Error('invalid reference');
      if (current === selection.current)
        setReference(JSON.stringify(value, null, 2));
    } catch {
      if (current === selection.current) setReferenceError(true);
    } finally {
      if (current === selection.current) setExporting(false);
    }
  };

  // View only can input Name (alias), so it should show alias as Name in metadata.
  return (
    <>
      <div className="mb-6" data-testid="metadata__name">
        <Typography.Text className="d-block gray-7 mb-2">Name</Typography.Text>
        <div>{displayName || '-'}</div>
      </div>

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
        <FieldTable
          columns={[COLUMN.NAME, COLUMN.TYPE, COLUMN.DESCRIPTION]}
          dataSource={fields}
          showExpandable
        />
      </div>

      <div className="mb-6" data-testid="metadata__sql-statement">
        <Typography.Text className="d-block gray-7 mb-2">
          SQL statement
        </Typography.Text>
        <SQLCodeBlock code={statement} showLineNumbers maxHeight="300" />
      </div>

      <div className="mb-6" data-testid="metadata__preview-data">
        <Typography.Text className="d-block gray-7 mb-2">
          Data preview (100 rows)
        </Typography.Text>
        <Button
          onClick={onPreviewData}
          loading={previewViewDataResult.loading || queryPreparing}
        >
          {queryPending || queryError ? text.check : text.preview}
        </Button>
        {queryStorageError ? (
          <Alert type="error" message={text.storageError} />
        ) : null}
        {queryScopeError ? (
          <Alert type="error" message={text.scopeError} />
        ) : null}
        {queryPending ? <Alert type="info" message={text.pending} /> : null}
        {queryReceipt?.terminalStatus &&
        queryReceipt.terminalStatus !== 'COMPLETED' ? (
          <Alert type="error" message={text.ended} />
        ) : null}
        {queryReceipt?.submission?.gateState === 'DENIED' ? (
          <Alert type="warning" message={text.denied} />
        ) : null}
        <div className="my-3">
          <PreviewData
            error={queryError}
            loading={previewViewDataResult.loading}
            previewData={queryReceipt?.data}
          />
        </div>
      </div>
      <div className="mb-6" data-testid="metadata__platform-query-reference">
        <Typography.Text className="d-block gray-7 mb-2">
          {text.referenceTitle}
        </Typography.Text>
        <Typography.Paragraph>{text.referenceDescription}</Typography.Paragraph>
        <Input
          aria-label={text.resourceId}
          placeholder={text.resourceId}
          value={resourceId}
          disabled={exporting}
          onChange={(event) => {
            selection.current++;
            setReference('');
            setResourceId(event.target.value);
          }}
        />
        <InputNumber
          aria-label={text.rowLimit}
          placeholder={text.rowLimit}
          precision={0}
          min={1}
          value={limit}
          disabled={exporting}
          onChange={(value) => {
            selection.current++;
            setReference('');
            setLimit(value);
          }}
        />
        <Button
          loading={exporting}
          disabled={
            !resourceId.trim() || !Number.isSafeInteger(limit) || limit <= 0
          }
          onClick={() => void exportReference()}
        >
          {text.exportReference}
        </Button>
        {referenceError ? (
          <Alert type="error" message={text.referenceError} />
        ) : null}
        {reference ? (
          <Input.TextArea
            aria-label={text.frozenReference}
            value={reference}
            readOnly
            autoSize
          />
        ) : null}
      </div>
    </>
  );
}
