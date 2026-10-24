import { Typography } from 'antd';
import useKailoText from '@/utils/kailoI18n';

export default function SQLPairFinished() {
  const t = useKailoText();
  return (
    <>
      <Typography.Text className="gray-8">
        {t('home.stepSqlPairTitle')}
      </Typography.Text>
      <div className="gray-7 text-sm mt-1">
        <div>{t('home.stepSqlPairDescription')}</div>
      </div>
    </>
  );
}
