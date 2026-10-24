import { Drawer, Tag, Typography } from 'antd';
import { getCompactTime } from '@/utils/time';
import { DrawerAction } from '@/hooks/useDrawerAction';
import GlobalLabel from '@/components/pages/knowledge/GlobalLabel';
import { MessageSquareIcon } from '@/components/kailo/KailoIcons';
import { Instruction } from '@/apollo/client/graphql/__types__';
import useKailoText from '@/utils/kailoI18n';

const { Text } = Typography;

type Props = DrawerAction<Instruction>;

// DD-152 (20 §13 抽屉): from the right, 480 wide, Kailo wording.
export default function InstructionDrawer(props: Props) {
  const { visible, defaultValue, onClose } = props;
  const t = useKailoText();

  return (
    <Drawer
      closable
      destroyOnClose
      onClose={onClose}
      title={t('knowledge.viewInstruction')}
      visible={visible}
      width={480}
    >
      <div className="mb-6">
        <Text type="secondary" className="d-block mb-2">
          {t('knowledge.instructionDetails')}
        </Text>
        <div>{defaultValue?.instruction || '-'}</div>
      </div>
      <div className="mb-6">
        <Text type="secondary" className="d-block mb-2">
          {t('knowledge.matchingQuestions')}
        </Text>
        <div>
          {defaultValue?.isDefault ? (
            <>
              <GlobalLabel />
              <Text className="ml-2" type="secondary">
                {t('knowledge.appliesToAll')}
              </Text>
            </>
          ) : (
            defaultValue?.questions.map((question, index) => (
              <div key={`${question}-${index}`} className="my-2">
                <Tag>
                  <MessageSquareIcon size={12} className="gray-7 mr-1" />
                  <Text>{question}</Text>
                </Tag>
              </div>
            ))
          )}
        </div>
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
