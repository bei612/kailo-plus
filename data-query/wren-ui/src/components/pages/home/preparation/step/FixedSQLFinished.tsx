import { Typography } from 'antd';
import useKailoText from '@/utils/kailoI18n';

export default function FixedSQLFinished() {
  const t = useKailoText();
  return (
    <>
      <Typography.Text className="gray-8">
        {t('home.stepFixedSqlTitle')}
      </Typography.Text>
      <div className="gray-7 text-sm mt-1">
        {t('home.stepFixedSqlDescription')}
      </div>
    </>
  );
}
