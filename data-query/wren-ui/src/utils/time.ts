import dayJs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { currentLocale } from './kailoI18n';

dayJs.extend(utc);
dayJs.extend(relativeTime);

export const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const nextTick = (ms = 1) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// DD-157 (20 §13.8): dates follow the Kailo locale.
const dayLocale = () => (currentLocale() === 'en' ? 'en' : 'zh-cn');

export const getRelativeTime = (time: string) => {
  return dayJs(time).locale(dayLocale()).fromNow();
};

export const getAbsoluteTime = (time: string) => {
  return dayJs(time).format('YYYY-MM-DD HH:mm:ss');
};

export const getCompactTime = (time: string) => {
  return dayJs(time).format('YYYY-MM-DD HH:mm');
};

export const getFullNameDate = (time: string) => {
  return dayLocale() === 'en'
    ? dayJs(time).format('MMMM DD, YYYY')
    : dayJs(time).format('YYYY年M月D日');
};

export const getShortDate = (time: string) => {
  return dayLocale() === 'en'
    ? dayJs(time).format('MMM DD')
    : dayJs(time).format('M月D日');
};
