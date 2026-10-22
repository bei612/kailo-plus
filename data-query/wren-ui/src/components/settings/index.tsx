import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Modal, Layout, Button } from 'antd';
import styled from 'styled-components';
import { SETTINGS } from '@/utils/enum';
import { makeIterable } from '@/utils/iteration';
import { ModalAction } from '@/hooks/useModalAction';
import SettingOutlined from '@ant-design/icons/SettingOutlined';
import DataSourceSettings from './DataSourceSettings';
import ProjectSettings from './ProjectSettings';
import { getSettingMenu } from './utils';
import useKailoText from '@/utils/kailoI18n';
import {
  useGetSettingsLazyQuery,
  GetSettingsQuery,
} from '@/apollo/client/graphql/settings.generated';

const { Sider, Content } = Layout;

type Props = ModalAction<any, any> & {
  loading?: boolean;
};

const StyledSider = styled(Sider)`
  .ant-layout-sider-children {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
`;

const StyledModal = styled(Modal)`
  .ant-modal-content {
    overflow: hidden;
  }
  .ant-modal-close-x {
    width: 48px;
    height: 48px;
    line-height: 48px;
  }
`;

const StyledButton = styled(Button)`
  display: flex;
  align-items: center;
  padding: 12px 8px;
  margin-bottom: 4px;
`;

const DynamicComponent = ({
  menu,
  data,
  refetch,
  closeModal,
}: {
  menu: SETTINGS;
  data?: GetSettingsQuery['settings'];
  refetch: () => void;
  closeModal: () => void;
}) => {
  const { dataSource, language } = data || {};
  return (
    {
      [SETTINGS.DATA_SOURCE]: (
        <DataSourceSettings
          type={dataSource?.type}
          sampleDataset={dataSource?.sampleDataset}
          properties={dataSource?.properties}
          refetchSettings={refetch}
          closeModal={closeModal}
        />
      ),
      [SETTINGS.PROJECT]: <ProjectSettings data={{ language }} />,
    }[menu] || null
  );
};

const MenuTemplate = ({ currentMenu, value, onClick, locale }) => {
  const current = getSettingMenu(value, locale);
  return (
    <StyledButton
      className={currentMenu === value ? 'geekblue-6 bg-gray-4' : 'gray-8'}
      type="text"
      block
      onClick={() => onClick({ value })}
      icon={<current.icon />}
    >
      {current.label}
    </StyledButton>
  );
};

const MenuIterator = makeIterable(MenuTemplate);

export default function Settings(props: Props) {
  const { onClose, visible } = props;
  const { locale } = useRouter();
  const t = useKailoText();
  const [menu, setMenu] = useState<SETTINGS>(SETTINGS.DATA_SOURCE);
  const current = getSettingMenu(menu, locale);
  const menuList = Object.keys(SETTINGS).map((key) => ({
    key,
    value: SETTINGS[key],
  }));
  const [fetchSettings, { data, refetch }] = useGetSettingsLazyQuery({
    fetchPolicy: 'cache-and-network',
  });

  useEffect(() => {
    if (visible) fetchSettings();
  }, [visible]);

  const onMenuClick = ({ value }) => setMenu(value);

  return (
    <StyledModal
      width={950}
      bodyStyle={{ padding: 0, height: 700 }}
      visible={visible}
      footer={null}
      onCancel={onClose}
      destroyOnClose
      centered
    >
      <Layout style={{ height: '100%' }}>
        <StyledSider width={310} className="border-r border-gray-4">
          <div className="gray-9 text-bold py-3 px-5">
            <SettingOutlined className="mr-2" />
            {t('settings')}
          </div>
          <div className="p-3 flex-grow-1">
            <MenuIterator
              data={menuList}
              currentMenu={menu}
              onClick={onMenuClick}
              locale={locale}
            />
          </div>
        </StyledSider>
        <Content className="d-flex flex-column">
          <div className="d-flex align-center gray-9 border-b border-gray-4 text-bold py-3 px-4">
            <current.icon className="mr-2" />
            {current.label}
          </div>
          <div className="flex-grow-1" style={{ overflowY: 'auto' }}>
            <DynamicComponent
              menu={menu}
              data={data?.settings}
              refetch={refetch}
              closeModal={onClose}
            />
          </div>
        </Content>
      </Layout>
    </StyledModal>
  );
}
