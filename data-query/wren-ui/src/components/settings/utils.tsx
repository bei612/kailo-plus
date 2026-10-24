import { SETTINGS } from '@/utils/enum';
import { kailoText } from '@/utils/kailoI18n';
import { DatabaseIcon, SettingsIcon } from '@/components/kailo/KailoIcons';

// 20 §2 section title: Title 2, 17/24 600.
export const SECTION_TITLE = {
  fontSize: 17,
  lineHeight: '24px',
  fontWeight: 600,
  color: 'var(--kailo-color-foreground)',
} as const;

export const getSettingMenu = (menu: SETTINGS, locale?: string) =>
  ({
    [SETTINGS.DATA_SOURCE]: {
      icon: DatabaseIcon,
      label: kailoText(locale, 'dataSource'),
    },
    [SETTINGS.PROJECT]: {
      icon: SettingsIcon,
      label: kailoText(locale, 'project'),
    },
  })[menu] || null;
