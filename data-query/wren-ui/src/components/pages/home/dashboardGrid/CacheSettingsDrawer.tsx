import { useEffect } from 'react';
import { CronExpressionParser } from 'cron-parser';
import moment from 'moment';
import {
  Button,
  Drawer,
  Form,
  Space,
  Switch,
  Select,
  Input,
  Row,
  Col,
  Divider,
  TimePicker,
} from 'antd';
import { browserTimeZone } from '@/utils/time';
import { DrawerAction } from '@/hooks/useDrawerAction';
import { ERROR_TEXTS } from '@/utils/error';
import { isValidCronLength, cronValidator } from '@/utils/validator';
import { CacheScheduleDayEnum } from '@/apollo/client/graphql/__types__';
import { kailoT, KailoTextKey } from '@/utils/kailoI18n';

type Props = DrawerAction & {
  loading?: boolean;
};

export interface Schedule {
  frequency: string;
  day?: string;
  hour?: number;
  minute?: number;
  cron?: string;
  timezone?: string;
}

const timeFormat = 'HH:mm';

const FREQUENCY = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  CUSTOM: 'CUSTOM',
  NEVER: 'NEVER',
};

// This sequence follows the first day of the week
const DAY_OF_WEEK = [
  CacheScheduleDayEnum.SUN,
  CacheScheduleDayEnum.MON,
  CacheScheduleDayEnum.TUE,
  CacheScheduleDayEnum.WED,
  CacheScheduleDayEnum.THU,
  CacheScheduleDayEnum.FRI,
  CacheScheduleDayEnum.SAT,
];

const DAY_LABELS: Record<CacheScheduleDayEnum, KailoTextKey> = {
  [CacheScheduleDayEnum.MON]: 'home.dayMonday',
  [CacheScheduleDayEnum.TUE]: 'home.dayTuesday',
  [CacheScheduleDayEnum.WED]: 'home.dayWednesday',
  [CacheScheduleDayEnum.THU]: 'home.dayThursday',
  [CacheScheduleDayEnum.FRI]: 'home.dayFriday',
  [CacheScheduleDayEnum.SAT]: 'home.daySaturday',
  [CacheScheduleDayEnum.SUN]: 'home.daySunday',
};

const getDayOfWeekText = (day: CacheScheduleDayEnum) => {
  return DAY_LABELS[day] ? kailoT(DAY_LABELS[day]) : '';
};

const FREQUENCY_LABELS: Record<string, KailoTextKey> = {
  [FREQUENCY.DAILY]: 'home.frequencyDaily',
  [FREQUENCY.WEEKLY]: 'home.frequencyWeekly',
  [FREQUENCY.CUSTOM]: 'home.frequencyCustom',
  [FREQUENCY.NEVER]: 'home.frequencyNever',
};

const getFrequencyText = (frequency: string) => {
  return FREQUENCY_LABELS[frequency]
    ? kailoT(FREQUENCY_LABELS[frequency])
    : frequency;
};

const getInitialSchedule = (frequency: string) => {
  let schedule = {};
  switch (frequency) {
    case FREQUENCY.DAILY:
      schedule = {
        day: null,
        time: moment('00:00', timeFormat),
        cron: null,
      };
      break;
    case FREQUENCY.WEEKLY:
      schedule = {
        day: DAY_OF_WEEK[0],
        time: moment('00:00', timeFormat),
        cron: null,
      };
      break;
    case FREQUENCY.CUSTOM:
      schedule = {
        day: null,
        time: null,
        cron: '0 0 * * *',
      };
      break;
    case FREQUENCY.NEVER:
      schedule = {
        day: null,
        time: null,
        cron: null,
      };
      break;
    default:
      break;
  }
  return schedule;
};

export const getScheduleText = (schedule: Schedule): string => {
  if (!schedule) return '';
  const { frequency } = schedule;

  const convertTime = (schedule: Schedule) => {
    const time = moment(
      `${schedule.hour}:${schedule.minute}`,
      timeFormat,
    ).format(timeFormat);
    return time;
  };

  switch (frequency) {
    case FREQUENCY.DAILY: {
      const time = convertTime(schedule);
      return kailoT('home.scheduleDaily', { time });
    }
    case FREQUENCY.WEEKLY: {
      const time = convertTime(schedule);
      return kailoT('home.scheduleWeekly', {
        day: getDayOfWeekText(schedule.day as CacheScheduleDayEnum),
        time,
      });
    }
    case FREQUENCY.CUSTOM: {
      return kailoT('home.scheduleCustom');
    }
    case FREQUENCY.NEVER: {
      return kailoT('home.scheduleManual');
    }
    default: {
      return '';
    }
  }
};

const getNextSchedule = (data: {
  frequency: string;
  day: string;
  time: moment.Moment;
  cron: string;
}) => {
  const { frequency, day, time, cron } = data;
  if (frequency === FREQUENCY.CUSTOM) return getNextScheduleByCron(cron);
  if (frequency === FREQUENCY.NEVER || !time) return null;

  // frequency daily or weekly calculation
  const now = moment();
  const targetTime = moment(
    `${now.format('YYYY-MM-DD')} ${time.format(timeFormat)}`,
  );

  // set the day of the week if it's a weekly schedule
  if (day) {
    const dayIndex = DAY_OF_WEEK.findIndex((d) => d === day);
    targetTime.set({ day: dayIndex });
  }

  // postpond the time if it's already passed
  if (now.isAfter(targetTime)) {
    if (frequency === FREQUENCY.DAILY) {
      targetTime.add(1, 'd');
    } else if (frequency === FREQUENCY.WEEKLY) {
      targetTime.add(7, 'd');
    }
  }

  return targetTime.isValid() ? targetTime.format('YYYY-MM-DD HH:mm') : null;
};

const getNextScheduleByCron = (cron: string) => {
  if (!cron || !isValidCronLength(cron)) return null;
  try {
    const interval = CronExpressionParser.parse(cron, { tz: 'UTC' });
    const targetTime = moment.utc(interval.next().toDate()).local();
    return targetTime.isValid() ? targetTime.format('YYYY-MM-DD HH:mm') : null;
  } catch (error) {
    console.warn(error);
    return null;
  }
};

export default function CacheSettingsDrawer(props: Props) {
  const { visible, defaultValue, loading, onClose, onSubmit } = props;
  const [form] = Form.useForm();

  const cacheEnabled = Form.useWatch('cacheEnabled', form);

  useEffect(() => {
    if (visible) {
      const { schedule, ...restValues } = defaultValue || {};
      form.setFieldsValue({
        ...restValues,
        schedule: {
          day: schedule?.day,
          frequency: schedule?.frequency,
          time:
            schedule?.hour.toString() && schedule?.minute.toString()
              ? moment(`${schedule?.hour}:${schedule?.minute}`, timeFormat)
              : null,
          cron: schedule?.cron,
        },
      });
    }
  }, [visible, defaultValue]);

  const afterVisibleChange = (visible: boolean) => {
    if (!visible) {
      form.resetFields();
    }
  };

  const submit = () => {
    form
      .validateFields()
      .then(async (values) => {
        const { schedule } = values;
        await onSubmit({
          ...values,
          schedule: values.cacheEnabled
            ? {
                frequency: schedule?.frequency,
                day: schedule?.day,
                hour: schedule?.time?.hour(),
                minute: schedule?.time?.minute(),
                cron: schedule?.cron,
                timezone: browserTimeZone,
              }
            : null,
        });
        onClose();
      })
      .catch(console.error);
  };

  return (
    <Drawer
      visible={visible}
      title={kailoT('home.cacheSettings')}
      width={440}
      closable
      destroyOnClose
      maskClosable={false}
      afterVisibleChange={afterVisibleChange}
      onClose={onClose}
      footer={
        <Space className="d-flex justify-end">
          <Button onClick={onClose} disabled={loading}>
            {kailoT('cancel')}
          </Button>
          <Button
            type="primary"
            onClick={submit}
            loading={loading}
            disabled={loading}
          >
            {kailoT('home.save')}
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label={kailoT('home.enableCaching')}
          name="cacheEnabled"
          valuePropName="checked"
          extra={kailoT('home.enableCachingHint')}
        >
          <Switch />
        </Form.Item>
        {cacheEnabled && <Schedule />}
      </Form>
    </Drawer>
  );
}

function Schedule() {
  const form = Form.useFormInstance();
  const frequency = Form.useWatch(['schedule', 'frequency'], form);
  const day = Form.useWatch(['schedule', 'day'], form);
  const time = Form.useWatch(['schedule', 'time'], form);
  const cron = Form.useWatch(['schedule', 'cron'], form);

  const onFrequencyChange = (value: string) => {
    form.setFieldsValue({
      schedule: { frequency: value, ...getInitialSchedule(value) },
    });
  };

  const nextSchedule = getNextSchedule({ frequency, day, time, cron });

  return (
    <>
      <Divider className="gray-7 text-sm">
        {kailoT('home.refreshSettings')}
      </Divider>
      <Form.Item
        label={kailoT('home.frequency')}
        name={['schedule', 'frequency']}
      >
        <Select
          placeholder={kailoT('home.selectFrequency')}
          options={Object.keys(FREQUENCY).map((key) => ({
            label: getFrequencyText(key),
            value: FREQUENCY[key],
          }))}
          onChange={onFrequencyChange}
        />
      </Form.Item>

      {frequency === FREQUENCY.DAILY && <DailyTimeSelection />}
      {frequency === FREQUENCY.WEEKLY && <WeeklyTimeSelection />}
      {frequency === FREQUENCY.CUSTOM && (
        <Form.Item
          label={kailoT('home.cronExpression')}
          name={['schedule', 'cron']}
          required={false}
          rules={[{ validator: cronValidator }]}
          extra={kailoT('home.cronHint')}
        >
          <Input style={{ maxWidth: 200 }} placeholder="* * * * *" />
        </Form.Item>
      )}

      {nextSchedule && (
        <div className="gray-7">
          {kailoT('home.nextRefresh')}
          <div className="gray-8">
            {nextSchedule} {browserTimeZone && <span>({browserTimeZone})</span>}
          </div>
        </div>
      )}
    </>
  );
}

function DailyTimeSelection() {
  return (
    <>
      <Form.Item
        label={kailoT('home.time')}
        name={['schedule', 'time']}
        required={false}
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CACHE_SETTINGS.TIME.REQUIRED,
          },
        ]}
      >
        <TimePicker minuteStep={10} format={timeFormat} />
      </Form.Item>
    </>
  );
}

function WeeklyTimeSelection() {
  return (
    <>
      <Row gutter={16}>
        <Col>
          <Form.Item
            label={kailoT('home.day')}
            name={['schedule', 'day']}
            required={false}
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.CACHE_SETTINGS.DAY.REQUIRED,
              },
            ]}
          >
            <Select
              style={{ minWidth: 123 }}
              options={DAY_OF_WEEK.map((value) => ({
                label: getDayOfWeekText(value),
                value,
              }))}
              placeholder={kailoT('home.selectDay')}
            />
          </Form.Item>
        </Col>
        <Col>
          <Form.Item
            label={kailoT('home.time')}
            name={['schedule', 'time']}
            required={false}
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.CACHE_SETTINGS.TIME.REQUIRED,
              },
            ]}
          >
            <TimePicker minuteStep={10} format={timeFormat} />
          </Form.Item>
        </Col>
      </Row>
    </>
  );
}
