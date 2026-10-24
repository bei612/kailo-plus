import { Button, Tooltip } from 'antd';
import styled from 'styled-components';
import { MoreIcon } from '@/utils/icons';
import { MORE_ACTION } from '@/utils/enum';
import { getCompactTime } from '@/utils/time';
import { DashboardDropdown } from '@/components/diagram/CustomDropdown';
import { ShareIcon } from '@/components/kailo/KailoIcons';
import useKailoText from '@/utils/kailoI18n';
import {
  Schedule,
  getScheduleText,
} from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';

interface Props {
  // DD-152: inside Kailo, 分享 is a page header action instead.
  showShare?: boolean;
  onShare?: () => void;
  isSupportCached: boolean;
  nextScheduleTime?: string;
  schedule?: Schedule;
  onCacheSettings?: () => void;
  onRefreshAll?: () => void;
}

const StyledHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 49px;
  padding: 8px 16px;
  background-color: var(--kailo-color-background);
  border-bottom: 1px solid var(--kailo-color-border);
`;

export default function DashboardHeader(props: Props) {
  const t = useKailoText();
  const {
    showShare,
    onShare,
    isSupportCached,
    nextScheduleTime,
    schedule,
    onCacheSettings,
    onRefreshAll,
  } = props;

  const scheduleTime = getScheduleText(schedule);

  const onMoreClick = async (action: MORE_ACTION) => {
    if (action === MORE_ACTION.CACHE_SETTINGS) {
      onCacheSettings?.();
    } else if (action === MORE_ACTION.REFRESH) {
      onRefreshAll?.();
    }
  };

  return (
    <StyledHeader>
      {/* DD-138(4), 07 §4.8.3: notify Kailo members about the dashboard. */}
      <div>
        {showShare && (
          <Button icon={<ShareIcon className="mr-1" />} onClick={onShare}>
            {t('share')}
          </Button>
        )}
      </div>
      <div>
        {schedule && (
          <div className="d-flex align-center gray-7 gx-2">
            {isSupportCached && (
              <>
                {nextScheduleTime ? (
                  <Tooltip
                    placement="bottom"
                    title={
                      <>
                        <div>
                          <span className="gray-6">
                            {t('home.nextSchedule')}
                          </span>{' '}
                          {getCompactTime(nextScheduleTime)}
                        </div>
                        {schedule.cron && (
                          <div>
                            <span className="gray-6">
                              {t('home.cronExpressionLabel')}
                            </span>{' '}
                            {schedule.cron}
                          </div>
                        )}
                      </>
                    }
                  >
                    <span className="cursor-pointer">{scheduleTime}</span>
                  </Tooltip>
                ) : (
                  scheduleTime
                )}
              </>
            )}
            <DashboardDropdown
              onMoreClick={onMoreClick}
              isSupportCached={isSupportCached}
            >
              <Button
                type="text"
                aria-label={t('home.moreActions')}
                icon={<MoreIcon className="gray-7" />}
              />
            </DashboardDropdown>
          </div>
        )}
      </div>
    </StyledHeader>
  );
}
