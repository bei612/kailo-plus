import { Typography } from 'antd';
import { Spinner } from '@/components/PageLoading';
import useKailoText from '@/utils/kailoI18n';

interface Props {
  generating?: boolean;
  correcting?: boolean;
  loading?: boolean;
}

export default function Generating(props: Props) {
  const { loading, generating, correcting } = props;
  const t = useKailoText();

  return (
    <>
      <Typography.Text className="gray-8">
        {t('home.stepGeneratingTitle')}
      </Typography.Text>
      <div className="gray-7 text-sm mt-1">
        {generating || correcting ? (
          <div className="d-flex align-center gx-2">
            {correcting ? t('home.stepCorrecting') : t('home.stepGenerating')}
            <Spinner className="gray-7" size={12} />
          </div>
        ) : (
          <>
            <div>{t('home.stepGenerated')}</div>
            {loading && (
              <div className="d-flex align-center gx-2 mt-1">
                {t('home.stepWrappingUp')}
                <Spinner className="gray-7" size={16} />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
