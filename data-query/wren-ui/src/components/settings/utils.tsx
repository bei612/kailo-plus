import { SETTINGS } from '@/utils/enum';
import { kailoText } from '@/utils/kailoI18n';
import DatabaseOutlined from '@ant-design/icons/DatabaseOutlined';
import ProjectOutlined from '@ant-design/icons/ProjectOutlined';

export const getSettingMenu = (menu: SETTINGS, locale?: string) =>
  ({
    [SETTINGS.DATA_SOURCE]: {
      icon: DatabaseOutlined,
      label: kailoText(locale, 'dataSource'),
    },
    [SETTINGS.PROJECT]: {
      icon: ProjectOutlined,
      label: kailoText(locale, 'project'),
    },
  })[menu] || null;
