import { useMemo } from 'react';
import { Modal, Button, Table, Typography, Collapse, Alert, Tag } from 'antd';
import styled from 'styled-components';
import WarningOutlined from '@ant-design/icons/WarningOutlined';
import PlusSquareOutlined from '@ant-design/icons/PlusSquareOutlined';
import LineOutlined from '@ant-design/icons/LineOutlined';
import FileDoneOutlined from '@ant-design/icons/FileDoneOutlined';
import { ModalAction } from '@/hooks/useModalAction';
import EllipsisWrapper from '@/components/EllipsisWrapper';
import useKailoText, { kailoT } from '@/utils/kailoI18n';
import { confirmDanger } from '@/utils/kailoHost';
import {
  DetailedChangeTable,
  DetailedAffectedCalculatedFields,
  DetailedAffectedRelationships,
  NodeType,
  SchemaChange,
  SchemaChangeType,
} from '@/apollo/client/graphql/__types__';

const StyledCollapse = styled(Collapse)`
  border: none;
  background-color: var(--kailo-color-card);
  .ant-collapse-item:last-child,
  .ant-collapse-item:last-child > .ant-collapse-header {
    border-radius: 0;
  }
  .ant-collapse-item,
  .ant-collapse-content {
    border-color: var(--kailo-color-border);
  }
  .ant-collapse-content-box {
    padding: 0;
  }
`;

const StyledTable = styled(Table)`
  padding-left: 36px;
  .ant-table {
    border: none;
    border-radius: 0;

    .non-expandable {
      .ant-table-row-expand-icon {
        display: none;
      }
    }

    .ant-table-expanded-row {
      .ant-table-cell {
        background-color: var(--kailo-color-card);
      }
    }
  }
`;

type Props = ModalAction<SchemaChange> & {
  loading?: boolean;
  payload?: {
    onResolveSchemaChange?: (type: SchemaChangeType) => void;
    isResolving?: boolean;
  };
};

// Titles are getters: read at render, so they follow the Kailo locale.
const nestedColumns = [
  {
    get title() {
      return kailoT('modeling.affectedResource');
    },
    dataIndex: 'resourceType',
    width: 200,
    render: (resourceType: NodeType) => {
      if (resourceType === NodeType.CALCULATED_FIELD) {
        return (
          <Tag className="ant-tag--geekblue">
            {kailoT('modeling.calculatedField')}
          </Tag>
        );
      }

      if (resourceType === NodeType.RELATION) {
        return (
          <Tag className="ant-tag--citrus">
            {kailoT('modeling.relationship')}
          </Tag>
        );
      }

      return null;
    },
  },
  {
    get title() {
      return kailoT('modeling.name');
    },
    dataIndex: 'displayName',
  },
];

const checkIsExpandable = (record: DetailedChangeTable) =>
  record.calculatedFields.length + record.relationships.length > 0
    ? ''
    : 'non-expandable';

const PanelHeader = (props) => {
  const { title, count, onResolve, isResolving } = props;
  const t = useKailoText();
  // Resolving deletes the affected models, relationships and calculated
  // fields: a destructive action, confirmed in Kailo's dialog.
  const resolve = (event) => {
    event.stopPropagation();
    void confirmDanger(
      {
        title: t('modeling.resolveConfirmTitle', { title }),
        description: t('modeling.resolveConfirmDescription'),
        confirmLabel: t('modeling.resolve'),
        cancelLabel: t('cancel'),
      },
      onResolve,
    );
  };
  return (
    <div
      className="d-flex align-center flex-grow-1"
      style={{ userSelect: 'none' }}
    >
      <b className="text-medium">{title}</b>
      <span className="flex-grow-1 text-right d-flex justify-end">
        <Typography.Text className="gray-7">
          {t('modeling.tablesAffected', { count })}
        </Typography.Text>
        <div style={{ width: 150 }}>
          {!!onResolve && (
            <Button
              type="text"
              size="small"
              danger
              onClick={resolve}
              loading={isResolving}
              icon={<FileDoneOutlined />}
            >
              {t('modeling.resolve')}
            </Button>
          )}
        </div>
      </span>
    </div>
  );
};

interface ExpandedRowsProps {
  record: DetailedChangeTable & {
    resources: Array<
      DetailedAffectedCalculatedFields | DetailedAffectedRelationships
    >;
  };
  tipMessage: string;
}

const ExpandedRows = ({ record, tipMessage }: ExpandedRowsProps) => {
  if (record.resources.length === 0) return null;

  return (
    <div className="pl-12">
      <Alert
        showIcon
        icon={
          <WarningOutlined
            style={{ color: 'var(--kailo-color-warning-text)' }}
          />
        }
        className="gray-7 ml-2 bg-gray-1 pl-0"
        style={{ border: 'none' }}
        message={tipMessage}
      />
      <Table
        columns={nestedColumns}
        dataSource={record.resources || []}
        pagination={{
          hideOnSinglePage: true,
          size: 'small',
          pageSize: 10,
        }}
        rowKey="rowKey"
        size="small"
        className="adm-nested-table"
      />
    </div>
  );
};

export default function SchemaChangeModal(props: Props) {
  const { visible, onClose, defaultValue: schemaChange, payload } = props;
  const { onResolveSchemaChange, isResolving } = payload || {};
  const t = useKailoText();

  const { deletedTables, deletedColumns, modifiedColumns } = useMemo(() => {
    const { deletedTables, deletedColumns, modifiedColumns } =
      schemaChange || {};

    if (!schemaChange)
      return {
        deletedTables,
        deletedColumns,
        modifiedColumns,
      };

    // transform data to render UI
    const transformData = (tables: DetailedChangeTable) => ({
      ...tables,
      resources: [
        ...tables.calculatedFields.map(
          (
            calculatedField: DetailedAffectedCalculatedFields,
            index: number,
          ) => ({
            ...calculatedField,
            resourceType: NodeType.CALCULATED_FIELD,
            rowKey: `${tables.sourceTableName}-${calculatedField.referenceName}-${index}`,
          }),
        ),
        ...tables.relationships.map(
          (relationship: DetailedAffectedRelationships, index: number) => ({
            ...relationship,
            resourceType: NodeType.RELATION,
            rowKey: `${tables.sourceTableName}-${relationship.referenceName}-${index}`,
          }),
        ),
      ],
      rowKey: tables.sourceTableName,
    });

    return {
      deletedTables: deletedTables?.map(transformData),
      deletedColumns: deletedColumns?.map(transformData),
      modifiedColumns: modifiedColumns?.map(transformData),
    };
  }, [schemaChange]);

  const columnsOfDeleteTables = [
    {
      title: t('modeling.affectedModel'),
      width: 200,
      dataIndex: 'displayName',
    },
    { title: t('modeling.sourceTableName'), dataIndex: 'sourceTableName' },
  ];

  const columnsOfDeletedColumns = [
    {
      title: t('modeling.affectedModel'),
      width: 200,
      dataIndex: 'displayName',
    },
    {
      title: t('modeling.deletedColumns'),
      dataIndex: 'columns',
      render: (columns) => {
        return (
          <EllipsisWrapper showMoreCount>
            {columns.map((column) => (
              <Tag className="ant-tag--geekblue" key={column.sourceColumnName}>
                {column.displayName}
              </Tag>
            ))}
          </EllipsisWrapper>
        );
      },
    },
  ];

  const columnsOfModifiedColumns = [
    {
      title: t('modeling.affectedModel'),
      width: 200,
      dataIndex: 'displayName',
    },
    {
      title: t('modeling.affectedColumns'),
      dataIndex: 'columns',
      render: (columns) => {
        return (
          <EllipsisWrapper showMoreCount>
            {columns.map((column) => (
              <Tag className="ant-tag--geekblue" key={column.sourceColumnName}>
                {column.displayName}
              </Tag>
            ))}
          </EllipsisWrapper>
        );
      },
    },
  ];

  return (
    <Modal
      title={
        <>
          <WarningOutlined
            className="mr-2"
            style={{ color: 'var(--kailo-color-warning-text)' }}
          />
          {t('modeling.schemaChanges')}
        </>
      }
      width={840}
      visible={visible}
      onCancel={onClose}
      destroyOnClose
      footer={null}
    >
      <Typography.Paragraph className="gray-7 mb-4">
        {t('modeling.schemaChangesIntro')}
      </Typography.Paragraph>
      <Alert
        showIcon
        type="warning"
        className="gray-8 mb-6"
        message={t('modeling.schemaChangesWarning')}
      />
      <StyledCollapse
        expandIcon={(panelProps) =>
          panelProps.isActive ? <LineOutlined /> : <PlusSquareOutlined />
        }
      >
        {deletedTables && (
          <Collapse.Panel
            header={
              <PanelHeader
                title={t('modeling.sourceTableDeleted')}
                count={deletedTables.length}
                onResolve={() =>
                  onResolveSchemaChange(SchemaChangeType.DELETED_TABLES)
                }
                isResolving={isResolving}
              ></PanelHeader>
            }
            key="deleteTables"
          >
            <StyledTable
              rowKey="rowKey"
              columns={columnsOfDeleteTables}
              dataSource={deletedTables}
              size="small"
              pagination={{
                hideOnSinglePage: true,
                size: 'small',
                pageSize: 10,
              }}
              rowClassName={checkIsExpandable}
              expandable={{
                expandedRowRender: (record: ExpandedRowsProps['record']) => (
                  <ExpandedRows
                    record={record}
                    tipMessage={t('modeling.tipDeletedTable')}
                  />
                ),
              }}
            />
          </Collapse.Panel>
        )}
        {deletedColumns && (
          <Collapse.Panel
            header={
              <PanelHeader
                title={t('modeling.sourceColumnDeleted')}
                count={deletedColumns.length}
                onResolve={() =>
                  onResolveSchemaChange(SchemaChangeType.DELETED_COLUMNS)
                }
                isResolving={isResolving}
              ></PanelHeader>
            }
            key="deleteColumns"
          >
            <StyledTable
              rowKey="rowKey"
              columns={columnsOfDeletedColumns}
              dataSource={deletedColumns}
              size="small"
              pagination={{
                hideOnSinglePage: true,
                size: 'small',
                pageSize: 10,
              }}
              rowClassName={checkIsExpandable}
              expandable={{
                expandedRowRender: (record: ExpandedRowsProps['record']) => (
                  <ExpandedRows
                    record={record}
                    tipMessage={t('modeling.tipDeletedColumn')}
                  />
                ),
              }}
            />
          </Collapse.Panel>
        )}
        {modifiedColumns && (
          <Collapse.Panel
            header={
              <PanelHeader
                title={t('modeling.sourceColumnTypeChanged')}
                count={modifiedColumns.length}
              ></PanelHeader>
            }
            key="modifiedColumns"
          >
            <StyledTable
              rowKey="rowKey"
              columns={columnsOfModifiedColumns}
              dataSource={modifiedColumns}
              size="small"
              pagination={{
                hideOnSinglePage: true,
                size: 'small',
                pageSize: 10,
              }}
              rowClassName={checkIsExpandable}
              expandable={{
                expandedRowRender: (record: ExpandedRowsProps['record']) => (
                  <ExpandedRows
                    record={record}
                    tipMessage={t('modeling.tipModifiedColumn')}
                  />
                ),
              }}
            />
          </Collapse.Panel>
        )}
      </StyledCollapse>
    </Modal>
  );
}
