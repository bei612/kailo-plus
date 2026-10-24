import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Modal, Layout, Button } from 'antd';
import styled from 'styled-components';
import { SETTINGS } from '@/utils/enum';
import { makeIterable } from '@/utils/iteration';
import { ModalAction } from '@/hooks/useModalAction';
import DataSourceSettings from './DataSourceSettings';
import ProjectSettings from './ProjectSettings';
import { getSettingMenu, SECTION_TITLE } from './utils';
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
  .ant-modal-body {
    padding: 0;
  }
`;

// 20 §13 list pane rows: 32 high, 13/500, radius 6, hover / selected tokens.
const StyledButton = styled(Button)<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 8px;
  margin-bottom: 2px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: ${(props) =>
    props.$selected
      ? 'var(--kailo-color-selected-foreground)'
      : 'var(--kailo-color-foreground)'} !important;
  background: ${(props) =>
    props.$selected ? 'var(--kailo-color-selected)' : 'transparent'} !important;

  &:hover {
    background: ${(props) =>
      props.$selected
        ? 'var(--kailo-color-selected)'
        : 'var(--kailo-color-hover)'} !important;
  }

  .anticon {
    color: inherit;
  }
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
      $selected={currentMenu === value}
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
      width={840}
      bodyStyle={{ padding: 0, height: 640 }}
      visible={visible}
      footer={null}
      onCancel={onClose}
      destroyOnClose
      centered
    >
      <Layout style={{ height: '100%' }}>
        <StyledSider
          width={220}
          style={{
            background: 'var(--kailo-color-background)',
            borderRight: '1px solid var(--kailo-color-border)',
          }}
        >
          <div style={SECTION_TITLE} className="px-4 pt-5 pb-3">
            {t('dataSourceSettings')}
          </div>
          <div className="px-2 flex-grow-1">
            <MenuIterator
              data={menuList}
              currentMenu={menu}
              onClick={onMenuClick}
              locale={locale}
            />
          </div>
        </StyledSider>
        <Content
          className="d-flex flex-column"
          style={{ background: 'var(--kailo-color-background)' }}
        >
          <div style={SECTION_TITLE} className="px-6 pt-5 pb-2">
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
