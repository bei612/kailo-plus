import { Typography } from 'antd';
import useKailoText from '@/utils/kailoI18n';

export default function ViewFinished() {
  const t = useKailoText();
  return (
    <>
      <Typography.Text className="gray-8">
        {t('home.stepViewTitle')}
      </Typography.Text>
      <div className="gray-7 text-sm mt-1">
        <div>{t('home.stepViewDescription')}</div>
      </div>
    </>
  );
}
