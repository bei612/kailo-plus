import { useEffect } from 'react';
import { Button, Space, Typography } from 'antd';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';
import WarningOutlined from '@ant-design/icons/WarningOutlined';
import { SyncStatus } from '@/apollo/client/graphql/__types__';
import {
  DeployStatusQueryHookResult,
  useDeployMutation,
} from '@/apollo/client/graphql/deploy.generated';
import { useDeployStatusContext } from '@/components/deploy/Context';
import useKailoText, { kailoT } from '@/utils/kailoI18n';
import { notify } from '@/utils/kailoHost';

const { Text } = Typography;

/**
 * Deploy state and action for the modeling page. DD-152: inside Kailo the
 * page header shows "发布模型" (primary, busy while deploying, disabled when
 * nothing is pending); at top level the same state drives <Deploy />.
 */
export function useDeploy(deployContext: DeployStatusQueryHookResult) {
  const { data, loading, startPolling, stopPolling } = deployContext;

  const [deployMutation, { data: deployResult, loading: deploying }] =
    useDeployMutation({
      onError: (error) => console.error(error),
      onCompleted: (data) => {
        if (data.deploy?.status === 'FAILED') {
          console.error('Failed to deploy - ', data.deploy?.error);
          notify.error(kailoT('deployFailed'), kailoT('deployFailedHint'));
        }
      },
    });

  useEffect(() => {
    // Stop polling deploy status if deploy failed
    if (
      deployResult?.deploy?.status === 'FAILED' &&
      data?.modelSync.status === SyncStatus.UNSYNCRONIZED
    ) {
      stopPolling?.();
    }
  }, [deployResult, data]);

  const syncStatus = data?.modelSync.status;

  useEffect(() => {
    if (syncStatus === SyncStatus.SYNCRONIZED) stopPolling?.();
  }, [syncStatus]);

  const onDeploy = () => {
    deployMutation();
    startPolling?.(1000);
  };

  const busy = deploying || syncStatus === SyncStatus.IN_PROGRESS;
  const disabled =
    deploying ||
    loading ||
    !syncStatus ||
    [SyncStatus.SYNCRONIZED, SyncStatus.IN_PROGRESS].includes(syncStatus);

  return {
    status: deploying ? SyncStatus.IN_PROGRESS : syncStatus,
    busy,
    disabled,
    onDeploy,
  };
}

function DeployStatus({ status }: { status?: SyncStatus }) {
  const t = useKailoText();
  return (
    {
      [SyncStatus.IN_PROGRESS]: (
        <Space size={[4, 0]}>
          <LoadingOutlined className="mr-1 gray-7" />
          <Text className="gray-7">{t('deploying')}</Text>
        </Space>
      ),
      [SyncStatus.SYNCRONIZED]: (
        <Space size={[4, 0]}>
          <CheckCircleOutlined className="mr-1 kailo-text-success" />
          <Text className="gray-7">{t('deploySynced')}</Text>
        </Space>
      ),
      [SyncStatus.UNSYNCRONIZED]: (
        <Space size={[4, 0]}>
          <WarningOutlined className="mr-1 kailo-text-warning" />
          <Text className="gray-7">{t('deployPending')}</Text>
        </Space>
      ),
    }[status] || null
  );
}

// Top-level visits only (the Kailo header carries the action in the frame).
export default function Deploy() {
  const t = useKailoText();
  const deploy = useDeploy(useDeployStatusContext());

  return (
    <Space size={[8, 0]}>
      <DeployStatus status={deploy.status} />
      <Button
        type="primary"
        disabled={deploy.disabled}
        loading={deploy.busy}
        onClick={deploy.onDeploy}
        data-guideid="deploy-model"
      >
        {t('deployModels')}
      </Button>
    </Space>
  );
}
