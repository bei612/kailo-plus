import { Button, Typography, Timeline } from 'antd';
import CloseCircleFilled from '@ant-design/icons/CloseCircleFilled';
import ToolOutlined from '@ant-design/icons/ToolOutlined';
import useModalAction from '@/hooks/useModalAction';
import ErrorCollapse from '@/components/ErrorCollapse';
import { FixSQLModal } from '@/components/modals/FixSQLModal';
import { Error } from '@/apollo/client/graphql/__types__';
import useKailoText from '@/utils/kailoI18n';
import { askErrorText } from '@/utils/askError';

export interface Props {
  children: React.ReactNode;
  error?: Error & {
    invalidSql?: string;
    fixStatement?: (sql: string) => Promise<void>;
    fixStatementLoading?: boolean;
  };
}

export default function ErrorBoundary({ children, error }: Props) {
  const fixItModal = useModalAction();
  const t = useKailoText();
  if (!error) return <>{children}</>;
  const hasInvalidSql = !!error.invalidSql;
  const text = askErrorText(error, t);
  return (
    <Timeline className="px-1 -mb-4">
      <Timeline.Item dot={<CloseCircleFilled className="kailo-text-danger" />}>
        <Typography.Text className="gray-8">
          {hasInvalidSql ? t('home.sqlGenerationFailed') : text.shortMessage}
        </Typography.Text>
        <div className="gray-7 text-sm mt-1">
          <div>
            {hasInvalidSql ? t('home.sqlGenerationFailedHint') : text.message}
          </div>
          {hasInvalidSql && (
            <>
              <div className="kailo-soft-block p-2 my-4">
                <ErrorCollapse message={error.message} defaultActive />
              </div>
              <Button
                className="mt-2 adm-fix-it-btn"
                icon={<ToolOutlined />}
                size="small"
                onClick={() => fixItModal.openModal({ sql: error.invalidSql })}
              >
                {t('home.fixSql')}
              </Button>
              <FixSQLModal
                {...fixItModal.state}
                loading={error.fixStatementLoading}
                onClose={fixItModal.closeModal}
                onSubmit={async (sql: string) => {
                  await error.fixStatement(sql);
                }}
              />
            </>
          )}
        </div>
      </Timeline.Item>
    </Timeline>
  );
}
