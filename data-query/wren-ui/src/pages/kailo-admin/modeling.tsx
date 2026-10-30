import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { forwardRef, useEffect, useMemo, useRef } from 'react';
import { notify } from '@/utils/kailoHost';
import client from '@/apollo/client';
import { runNativeMetadataWrite } from '@/utils/errorHandler';
import styled from 'styled-components';
import { FORM_MODE, MORE_ACTION, NODE_TYPE, Path } from '@/utils/enum';
import { editCalculatedField } from '@/utils/modelingHelper';
import AdminSurfaceLayout from '@/components/layouts/AdminSurfaceLayout';
import KailoAdminSurface, {
  useKailoAdminPage,
} from '@/components/kailo/KailoAdminSurface';
import ErrorCollapse from '@/components/ErrorCollapse';
import MetadataDrawer from '@/components/pages/modeling/MetadataDrawer';
import EditMetadataModal from '@/components/pages/modeling/EditMetadataModal';
import CalculatedFieldModal from '@/components/modals/CalculatedFieldModal';
import ModelDrawer from '@/components/pages/modeling/ModelDrawer';
import RelationModal, {
  RelationFormValues,
} from '@/components/modals/RelationModal';
import useDrawerAction from '@/hooks/useDrawerAction';
import useModalAction from '@/hooks/useModalAction';
import useRelationshipModal from '@/hooks/useRelationshipModal';
import { convertFormValuesToIdentifier } from '@/hooks/useCombineFieldOptions';
import { ClickPayload } from '@/components/diagram/Context';
import { DeployStatusContext } from '@/components/deploy/Context';
import Deploy, { useDeploy } from '@/components/deploy/Deploy';
import useKailoSession from '@/hooks/useKailoSession';
import useKailoText, { kailoT } from '@/utils/kailoI18n';
import { DIAGRAM } from '@/apollo/client/graphql/diagram';
import { LIST_MODELS } from '@/apollo/client/graphql/model';
import { useDiagramQuery } from '@/apollo/client/graphql/diagram.generated';
import { useDeployStatusQuery } from '@/apollo/client/graphql/deploy.generated';
import { useDeleteViewMutation } from '@/apollo/client/graphql/view.generated';
import {
  useCreateModelMutation,
  useDeleteModelMutation,
  useUpdateModelMutation,
} from '@/apollo/client/graphql/model.generated';
import {
  useUpdateModelMetadataMutation,
  useUpdateViewMetadataMutation,
} from '@/apollo/client/graphql/metadata.generated';
import {
  useCreateCalculatedFieldMutation,
  useUpdateCalculatedFieldMutation,
  useDeleteCalculatedFieldMutation,
} from '@/apollo/client/graphql/calculatedField.generated';
import {
  useCreateRelationshipMutation,
  useDeleteRelationshipMutation,
  useUpdateRelationshipMutation,
} from '@/apollo/client/graphql/relationship.generated';
import * as events from '@/utils/events';

const Diagram = dynamic(() => import('@/components/diagram'), { ssr: false });
// https://github.com/vercel/next.js/issues/4957#issuecomment-413841689
const ForwardDiagram = forwardRef(function ForwardDiagram(props: any, ref) {
  return <Diagram {...props} forwardRef={ref} />;
});

const DiagramWrapper = styled.div`
  position: relative;
  height: 100%;
`;

// Top-level visits only: inside Kailo 发布模型 is the page header action.
const DeployBar = styled.div`
  position: absolute;
  top: 16px;
  right: 24px;
  z-index: 10;
`;

// DD-138(6) (`07` §4.8.5): the semantic modeling admin surface — the model
// tree (content) and the diagram, nothing of the product shell around it.
export default function ModelingSurface() {
  return (
    <KailoAdminSurface path={Path.AdminModeling}>
      <Modeling />
    </KailoAdminSurface>
  );
}

export function Modeling() {
  const router = useRouter();
  const diagramRef = useRef(null);
  const { hostPage } = useKailoSession();

  const { data, error: diagramError } = useDiagramQuery({
    fetchPolicy: 'no-cache',
    onCompleted: () => {
      diagramRef.current?.fitView();
    },
  });

  const deployStatusQueryResult = useDeployStatusQuery({
    pollInterval: 1000,
    fetchPolicy: 'no-cache',
  });

  const refetchQueries = [{ query: DIAGRAM }];
  const refetchQueriesForModel = [...refetchQueries, { query: LIST_MODELS }];
  const getBaseOptions = (options) => {
    return {
      onError: (error) => console.error(error),
      refetchQueries,
      awaitRefetchQueries: true,
      ...options,
      onCompleted: () => {
        // refetch to get latest deploy status
        deployStatusQueryResult.refetch();

        options.onCompleted && options.onCompleted();
      },
    };
  };

  const [createCalculatedField, { loading: calculatedFieldCreating }] =
    useCreateCalculatedFieldMutation(
      getBaseOptions({
        onError: null,
        onCompleted: () => {
          notify.success(kailoT('modeling.calculatedFieldCreated'));
        },
      }),
    );

  const [updateCalculatedField, { loading: calculatedFieldUpdating }] =
    useUpdateCalculatedFieldMutation(
      getBaseOptions({
        onError: null,
        onCompleted: () => {
          notify.success(kailoT('modeling.calculatedFieldUpdated'));
        },
      }),
    );

  const [deleteCalculatedField] = useDeleteCalculatedFieldMutation(
    getBaseOptions({
      onCompleted: () => {
        notify.success(kailoT('modeling.calculatedFieldDeleted'));
      },
    }),
  );

  const [createModelMutation, { loading: modelCreating }] =
    useCreateModelMutation();

  const [deleteModelMutation] = useDeleteModelMutation(
    getBaseOptions({
      onCompleted: () => {
        notify.success(kailoT('modeling.modelDeleted'));
      },
      refetchQueries: refetchQueriesForModel,
    }),
  );

  const [updateModelMutation, { loading: modelUpdating }] =
    useUpdateModelMutation(
      getBaseOptions({
        onCompleted: () => {
          notify.success(kailoT('modeling.modelUpdated'));
        },
        refetchQueries: refetchQueriesForModel,
      }),
    );

  const [deleteViewMutation] = useDeleteViewMutation(
    getBaseOptions({
      onCompleted: () => {
        notify.success(kailoT('modeling.viewDeleted'));
      },
    }),
  );

  const [updateModelMetadata, { loading: modelMetadataUpdating }] =
    useUpdateModelMetadataMutation(
      getBaseOptions({
        onCompleted: () => {
          notify.success(kailoT('modeling.modelMetadataUpdated'));
        },
      }),
    );

  const [createRelationshipMutation, { loading: relationshipCreating }] =
    useCreateRelationshipMutation(
      getBaseOptions({
        onCompleted: () => {
          notify.success(kailoT('modeling.relationshipCreated'));
        },
      }),
    );

  const [deleteRelationshipMutation] = useDeleteRelationshipMutation(
    getBaseOptions({
      onCompleted: () => {
        notify.success(kailoT('modeling.relationshipDeleted'));
      },
    }),
  );

  const [updateRelationshipMutation, { loading: relationshipUpdating }] =
    useUpdateRelationshipMutation(
      getBaseOptions({
        onCompleted: () => {
          notify.success(kailoT('modeling.relationshipUpdated'));
        },
      }),
    );

  const [updateViewMetadata, { loading: viewMetadataUpdating }] =
    useUpdateViewMetadataMutation(
      getBaseOptions({
        onCompleted: () => {
          notify.success(kailoT('modeling.viewMetadataUpdated'));
        },
      }),
    );

  const diagramData = useMemo(() => {
    if (diagramError || !data) return null;
    return data?.diagram;
  }, [data, diagramError]);

  const metadataDrawer = useDrawerAction();
  const modelDrawer = useDrawerAction();
  const editMetadataModal = useModalAction();
  const calculatedFieldModal = useModalAction();
  const relationshipModal = useRelationshipModal(diagramData);
  const t = useKailoText();
  const deploy = useDeploy(deployStatusQueryResult);

  // DD-138(6): Kailo draws "管理 › 数据源 › 语义建模"; the surface adds its
  // primary 发布模型 (busy while deploying, disabled when nothing is pending).
  useKailoAdminPage({
    ready: !!diagramData || !!diagramError,
    actions: [
      {
        id: 'deploy',
        label: t('deployModels'),
        variant: 'primary',
        icon: 'rocket',
        busy: deploy.busy,
        disabled: deploy.disabled,
      },
    ],
    onAction: (id) => {
      if (id === 'deploy' && !deploy.disabled) deploy.onDeploy();
    },
  });

  useEffect(() => {
    if (!diagramData) {
      if (metadataDrawer.state.visible) metadataDrawer.closeDrawer();
      if (modelDrawer.state.formMode === FORM_MODE.EDIT)
        modelDrawer.closeDrawer();
      return;
    }
    if (metadataDrawer.state.visible) {
      const data = metadataDrawer.state.defaultValue;
      let currentNodeData = null;
      switch (data.nodeType) {
        case NODE_TYPE.MODEL: {
          currentNodeData = diagramData.models.find(
            (model) => model.modelId === data.modelId,
          );
          break;
        }

        case NODE_TYPE.VIEW: {
          currentNodeData = diagramData.views.find(
            (view) => view.viewId === data.viewId,
          );
          break;
        }

        default:
          break;
      }

      metadataDrawer.updateState(currentNodeData);
    }
  }, [diagramData]);

  // register event listener for global
  useEffect(() => {
    events.subscribe(events.EVENT_NAME.GO_TO_FIRST_MODEL, goToFirstModel);
    return () => {
      events.unsubscribe(events.EVENT_NAME.GO_TO_FIRST_MODEL, goToFirstModel);
    };
  }, []);

  const goToFirstModel = () => {
    if (diagramRef.current) {
      const { getNodes } = diagramRef.current;
      const node = getNodes()[0];
      node?.id && onSelect([node.id]);
    }
  };

  const onSelect = (selectKeys) => {
    if (diagramRef.current) {
      const { getNodes, fitBounds } = diagramRef.current;
      const node = getNodes().find((node) => node.id === selectKeys[0]);
      const position = {
        ...node.position,
        width: node.width,
        height: node.height,
      };
      fitBounds(position);
    }
  };

  const onNodeClick = async (payload: ClickPayload) => {
    metadataDrawer.openDrawer(payload.data);
  };

  const onMoreClick = (payload) => {
    const { type, data } = payload;
    const { nodeType } = data;
    const action = {
      [MORE_ACTION.UPDATE_COLUMNS]: () => {
        switch (nodeType) {
          case NODE_TYPE.MODEL:
            modelDrawer.openDrawer(data);
            break;
          default:
            console.log(data);
            break;
        }
      },
      [MORE_ACTION.EDIT]: () => {
        switch (nodeType) {
          case NODE_TYPE.CALCULATED_FIELD:
            editCalculatedField(
              { ...payload, diagramData },
              calculatedFieldModal.openModal,
            );
            break;
          case NODE_TYPE.RELATION:
            relationshipModal.openModal(data);
            break;

          default:
            console.log(data);
            break;
        }
      },
      [MORE_ACTION.DELETE]: async () => {
        switch (nodeType) {
          case NODE_TYPE.MODEL:
            await deleteModelMutation({
              variables: { where: { id: data.modelId } },
            });
            break;
          case NODE_TYPE.CALCULATED_FIELD:
            await deleteCalculatedField({
              variables: { where: { id: data.columnId } },
            });
            break;
          case NODE_TYPE.RELATION:
            await deleteRelationshipMutation({
              variables: { where: { id: data.relationId } },
            });
            break;
          case NODE_TYPE.VIEW:
            await deleteViewMutation({
              variables: { where: { id: data.viewId } },
            });
            break;

          default:
            console.log(data);
            break;
        }
      },
    };
    action[type] && action[type]();
  };

  const onAddClick = (payload) => {
    const { targetNodeType, data } = payload;
    switch (targetNodeType) {
      case NODE_TYPE.CALCULATED_FIELD:
        calculatedFieldModal.openModal(null, {
          models: diagramData.models,
          sourceModel: data,
        });
        break;
      case NODE_TYPE.RELATION:
        relationshipModal.openModal(data);
        break;
      default:
        console.log('add', targetNodeType);
        break;
    }
  };

  const calculatedFieldLoading =
    calculatedFieldCreating || calculatedFieldUpdating;
  const editMetadataLoading = modelMetadataUpdating || viewMetadataUpdating;
  const modelLoading = modelCreating || modelUpdating;
  const relationshipLoading = relationshipUpdating || relationshipCreating;

  return (
    <DeployStatusContext.Provider value={{ ...deployStatusQueryResult }}>
      <AdminSurfaceLayout
        loading={!diagramError && diagramData === null}
        sidebar={{
          data: diagramData,
          onOpenModelDrawer: modelDrawer.openDrawer,
          onSelect,
        }}
      >
        {diagramError ? (
          <ErrorCollapse message={diagramError.message} defaultActive />
        ) : (
          <DiagramWrapper>
            {!hostPage && (
              <DeployBar>
                <Deploy />
              </DeployBar>
            )}
            <ForwardDiagram
              ref={diagramRef}
              data={diagramData}
              onMoreClick={onMoreClick}
              onNodeClick={onNodeClick}
              onAddClick={onAddClick}
            />
          </DiagramWrapper>
        )}
        <MetadataDrawer
          {...metadataDrawer.state}
          visible={!!diagramData && metadataDrawer.state.visible}
          defaultValue={diagramData ? metadataDrawer.state.defaultValue : null}
          onClose={metadataDrawer.closeDrawer}
          onEditClick={editMetadataModal.openModal}
        />
        <EditMetadataModal
          {...editMetadataModal.state}
          visible={!!diagramData && editMetadataModal.state.visible}
          onClose={editMetadataModal.closeModal}
          loading={editMetadataLoading}
          onSubmit={async ({ nodeType, data }) => {
            const { modelId, viewId, ...metadata } = data;
            switch (nodeType) {
              case NODE_TYPE.MODEL: {
                await updateModelMetadata({
                  variables: { where: { id: modelId }, data: metadata },
                });
                break;
              }

              case NODE_TYPE.VIEW: {
                await updateViewMetadata({
                  variables: { where: { id: viewId }, data: metadata },
                });
                break;
              }

              default:
                console.log('onSubmit', nodeType, data);
                break;
            }
          }}
        />
        <ModelDrawer
          {...modelDrawer.state}
          visible={
            modelDrawer.state.visible &&
            (modelDrawer.state.formMode === FORM_MODE.CREATE || !!diagramData)
          }
          onClose={modelDrawer.closeDrawer}
          submitting={modelLoading}
          onSubmit={async ({ id, data }) => {
            if (id) {
              await updateModelMutation({ variables: { where: { id }, data } });
            } else {
              await runNativeMetadataWrite({
                nativeType: 'model',
                variables: { data },
                locale: router.locale,
                submit: (variables, guarded) =>
                  createModelMutation({
                    variables,
                    ...(guarded
                      ? { context: { nativeWriteGuarded: true } }
                      : {}),
                  }),
                observe: async (nativeId) => {
                  const response = await client.query({
                    query: LIST_MODELS,
                    fetchPolicy: 'no-cache',
                  });
                  return response.data?.listModels?.find(
                    (row) => row.id === nativeId,
                  );
                },
              });
              // The native creation is already verified. A secondary diagram
              // or deploy-status refresh cannot turn it into an unsent write.
              void client
                .refetchQueries({ include: [DIAGRAM, LIST_MODELS] })
                .catch((error) => console.error(error));
              void deployStatusQueryResult
                .refetch()
                .catch((error) => console.error(error));
              notify.success(kailoT('modeling.modelCreated'));
            }
          }}
        />
        <CalculatedFieldModal
          {...calculatedFieldModal.state}
          visible={!!diagramData && calculatedFieldModal.state.visible}
          onClose={calculatedFieldModal.closeModal}
          loading={calculatedFieldLoading}
          onSubmit={async ({ id, data }) => {
            if (id) {
              await updateCalculatedField({
                variables: { where: { id }, data },
              });
            } else {
              await createCalculatedField({ variables: { data } });
            }
          }}
        />
        <RelationModal
          {...relationshipModal.state}
          visible={!!diagramData && relationshipModal.state.visible}
          onClose={relationshipModal.onClose}
          loading={relationshipLoading}
          onSubmit={async (
            values: RelationFormValues & { relationId?: number },
          ) => {
            const relation = convertFormValuesToIdentifier(values);
            if (values.relationId) {
              await updateRelationshipMutation({
                variables: {
                  where: { id: values.relationId },
                  data: { type: relation.type },
                },
              });
            } else {
              await createRelationshipMutation({
                variables: {
                  data: {
                    fromModelId: Number(relation.fromField.modelId),
                    fromColumnId: Number(relation.fromField.fieldId),
                    toModelId: Number(relation.toField.modelId),
                    toColumnId: Number(relation.toField.fieldId),
                    type: relation.type,
                  },
                },
              });
            }
          }}
        />
      </AdminSurfaceLayout>
    </DeployStatusContext.Provider>
  );
}
