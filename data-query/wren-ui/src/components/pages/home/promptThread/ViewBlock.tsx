import { Button } from 'antd';
import FileDoneOutlined from '@ant-design/icons/FileDoneOutlined';
import SaveOutlined from '@ant-design/icons/SaveOutlined';
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
        {/* DD-138(6): views are maintained on the modeling admin surface;
            the business page names the view and links to no admin page. */}
        {t('home.generatedFromView')} {view.displayName}
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
