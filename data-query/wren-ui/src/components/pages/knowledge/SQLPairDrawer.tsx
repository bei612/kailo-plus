import { Drawer, Typography } from 'antd';
import { getCompactTime } from '@/utils/time';
import { DrawerAction } from '@/hooks/useDrawerAction';
import SQLCodeBlock from '@/components/code/SQLCodeBlock';
import { SqlPair } from '@/apollo/client/graphql/__types__';
import useKailoText from '@/utils/kailoI18n';

const { Text } = Typography;

type Props = DrawerAction<SqlPair>;

// DD-157 (20 §13 抽屉): from the right, 480 wide, Kailo wording.
export default function SQLPairDrawer(props: Props) {
  const { visible, defaultValue, onClose } = props;
  const t = useKailoText();

  return (
    <Drawer
      closable
      destroyOnClose
      onClose={onClose}
      title={t('knowledge.viewSqlPair')}
      visible={visible}
      width={480}
    >
      <div className="mb-6">
        <Text type="secondary" className="d-block mb-2">
          {t('knowledge.question')}
        </Text>
        <div>{defaultValue?.question || '-'}</div>
      </div>
      <div className="mb-6">
        <Text type="secondary" className="d-block mb-2">
          {t('knowledge.sqlStatement')}
        </Text>
        <SQLCodeBlock
          code={defaultValue?.sql || ''}
          showLineNumbers
          maxHeight="500"
        />
      </div>
      <div className="mb-6">
        <Text type="secondary" className="d-block mb-2">
          {t('knowledge.createdTime')}
        </Text>
        <div>
          {defaultValue?.createdAt
            ? getCompactTime(defaultValue.createdAt)
            : '-'}
        </div>
      </div>
    </Drawer>
  );
}
