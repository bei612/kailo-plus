import { useEffect, useMemo, useState } from 'react';
import { notify } from '@/utils/kailoHost';
import useKailoText, { kailoT } from '@/utils/kailoI18n';
import { PlusIcon, RefreshIcon } from '@/components/kailo/KailoIcons';
import { DataNode } from 'antd/es/tree';
import { DiagramModel } from '@/utils/data';
import { getNodeTypeIcon } from '@/utils/nodeType';
import {
  createTreeGroupNode,
  getColumnNode,
  GroupActionButton,
} from '@/components/sidebar/utils';
import useModalAction from '@/hooks/useModalAction';
import LabelTitle from '@/components/sidebar/LabelTitle';
import WarningOutlined from '@ant-design/icons/WarningOutlined';
import { StyledSidebarTree } from '@/components/sidebar/Modeling';
import SchemaChangeModal from '@/components/modals/SchemaChangeModal';
import {
  SchemaChange,
  SchemaChangeType,
} from '@/apollo/client/graphql/__types__';
import {
  useResolveSchemaChangeMutation,
  useSchemaChangeQuery,
  useTriggerDataSourceDetectionMutation,
} from '@/apollo/client/graphql/dataSource.generated';
import { DIAGRAM } from '@/apollo/client/graphql/diagram';
import { LIST_MODELS } from '@/apollo/client/graphql/model';
import { getRelativeTime } from '@/utils/time';
import ErrorCollapse from '@/components/ErrorCollapse';

interface Props {
  [key: string]: any;
  models: DiagramModel[];
  onOpenModelDrawer: () => void;
}

const getHasSchemaChange = (schemaChange: SchemaChange) => {
  return [
    schemaChange?.deletedTables,
    schemaChange?.deletedColumns,
    schemaChange?.modifiedColumns,
  ].some((changes) => !!changes);
};

export default function ModelTree(props: Props) {
  const { onOpenModelDrawer, models } = props;
  const t = useKailoText();

  const schemaChangeModal = useModalAction();
  const [triggerDataSourceDetection, { loading: isDetecting }] =
    useTriggerDataSourceDetectionMutation({
      onError: (error) => console.error(error),
      onCompleted: async (data) => {
        if (data.triggerDataSourceDetection) {
          notify.warning(kailoT('modeling.schemaChangeDetected'));
        } else {
          notify.success(kailoT('modeling.noSchemaChange'));
        }
        await refetchSchemaChange();
      },
    });
  const [resolveSchemaChange, { loading: isResolving }] =
    useResolveSchemaChangeMutation({
      onError: (error) => console.error(error),
      onCompleted: async (_, options) => {
        const { type } = options.variables?.where;
        if (type === SchemaChangeType.DELETED_TABLES) {
          notify.success(kailoT('modeling.deletedTablesResolved'));
        } else if (type === SchemaChangeType.DELETED_COLUMNS) {
          notify.success(kailoT('modeling.deletedColumnsResolved'));
        }

        const { data, error } = await refetchSchemaChange();
        // if all schema changes are resolved, close the modal
        if (
          !error &&
          data?.schemaChange &&
          !getHasSchemaChange(data.schemaChange)
        ) {
          schemaChangeModal.closeModal();
        }
      },
      refetchQueries: [{ query: DIAGRAM }, { query: LIST_MODELS }],
    });
  const {
    data,
    error: schemaChangeError,
    refetch: refetchSchemaChange,
  } = useSchemaChangeQuery({
    fetchPolicy: 'no-cache',
  });
  const schemaChangeData = schemaChangeError ? undefined : data;
  const hasSchemaChange = useMemo(
    () => getHasSchemaChange(schemaChangeData?.schemaChange),
    [schemaChangeData],
  );
  const onOpenSchemaChange = () => {
    schemaChangeModal.openModal();
  };
  const onResolveSchemaChange = (type: SchemaChangeType) => {
    resolveSchemaChange({ variables: { where: { type } } });
  };

  const getModelGroupNode = createTreeGroupNode({
    groupName: t('modeling.models'),
    groupKey: 'models',
    emptyText: t('modeling.noModels'),
    actions: [
      {
        key: 'trigger-schema-detection',
        disabled: isDetecting,
        render: ({ key, disabled }) => (
          <span
            key={key}
            role="button"
            aria-label={t('modeling.detectSchemaChange')}
            className={`adm-actionIcon d-inline-flex ${
              disabled ? 'adm-actionIcon--disabled' : ''
            }`}
            title={
              schemaChangeData?.schemaChange.lastSchemaChangeTime
                ? t('modeling.lastRefresh', {
                    time: getRelativeTime(
                      schemaChangeData?.schemaChange.lastSchemaChangeTime,
                    ),
                  })
                : t('modeling.detectSchemaChange')
            }
            onClick={() => !disabled && triggerDataSourceDetection()}
          >
            <RefreshIcon
              size={14}
              className={isDetecting ? 'anticon-spin' : undefined}
              style={{ padding: 3 }}
            />
          </span>
        ),
      },
      {
        key: 'add-model',
        render: () => (
          <GroupActionButton
            data-guideid="add-model"
            data-testid="add-model"
            icon={<PlusIcon size={14} className="mr-1" />}
            size="small"
            onClick={() => onOpenModelDrawer()}
          >
            {t('newThread')}
          </GroupActionButton>
        ),
      },
    ],
  });

  const [tree, setTree] = useState<DataNode[]>(getModelGroupNode());

  useEffect(() => {
    setTree((_tree) =>
      getModelGroupNode({
        quotaUsage: models.length,
        appendSlot: hasSchemaChange && (
          <span className="adm-actionIcon mx-2" onClick={onOpenSchemaChange}>
            <WarningOutlined
              style={{ color: 'var(--kailo-color-warning-text)' }}
              title={t('modeling.reviewSchemaChange')}
            />
          </span>
        ),
        children: models.map((model) => {
          const nodeKey = model.id;

          const children = [
            ...getColumnNode(nodeKey, [
              ...model.fields,
              ...model.calculatedFields,
            ]),
          ];

          return {
            children,
            className: 'adm-treeNode',
            icon: getNodeTypeIcon({ nodeType: model.nodeType }),
            id: nodeKey,
            isLeaf: false,
            key: nodeKey,
            title: <LabelTitle title={model.displayName} />,
            type: model.nodeType,
          };
        }),
      }),
    );
  }, [models, hasSchemaChange, schemaChangeData, isDetecting]);

  return (
    <>
      <StyledSidebarTree {...props} treeData={tree} />
      {schemaChangeError && (
        <ErrorCollapse message={schemaChangeError.message} defaultActive />
      )}
      <SchemaChangeModal
        {...schemaChangeModal.state}
        visible={
          !schemaChangeError &&
          !!schemaChangeData &&
          schemaChangeModal.state.visible
        }
        defaultValue={schemaChangeData?.schemaChange}
        payload={{ onResolveSchemaChange, isResolving }}
        onClose={schemaChangeModal.closeModal}
      />
    </>
  );
}
