import { Typography } from 'antd';
import GlobalOutlined from '@ant-design/icons/GlobalOutlined';
import useKailoText from '@/utils/kailoI18n';

const { Text } = Typography;

export default function GlobalLabel() {
  const t = useKailoText();
  return (
    <>
      <GlobalOutlined className="mr-2 gray-7" />
      <Text>{t('knowledge.global')}</Text>
    </>
  );
}
