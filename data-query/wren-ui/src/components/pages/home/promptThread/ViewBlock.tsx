import Link from 'next/link';
import { Button } from 'antd';
import FileDoneOutlined from '@ant-design/icons/FileDoneOutlined';
import SaveOutlined from '@ant-design/icons/SaveOutlined';
import { Path } from '@/utils/enum';
import { ViewInfo } from '@/apollo/client/graphql/__types__';
import useKailoText from '@/utils/kailoI18n';

interface Props {
  view?: ViewInfo;
  onClick: () => void;
}

export default function ViewBlock({ view, onClick }: Props) {
  const isViewSaved = !!view;
  const t = useKailoText();

  if (isViewSaved) {
    return (
      <div className="gray-7 text-medium">
        <FileDoneOutlined className="mr-2" />
        {t('home.generatedFromView')}{' '}
        <Link
          className="gray-7"
          href={`${Path.Modeling}?viewId=${view.id}&openMetadata=true`}
          target="_blank"
          rel="noreferrer noopener"
        >
          {view.displayName}
        </Link>
      </div>
    );
  }

  return (
    <Button
      className="gray-7"
      type="text"
      size="small"
      icon={<SaveOutlined />}
      onClick={onClick}
    >
      {t('home.saveAsView')}
    </Button>
  );
}
