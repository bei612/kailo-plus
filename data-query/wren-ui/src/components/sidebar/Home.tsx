import clsx from 'clsx';
import { KeyboardEvent } from 'react';
import { useRouter } from 'next/router';
import { useParams } from 'next/navigation';
import { Button, Tooltip } from 'antd';
import { PlusIcon } from '@/components/kailo/KailoIcons';
import {
  KailoListProgress,
  KailoLoadError,
  KailoPanePager,
  KailoPaneSkeleton,
} from '@/components/kailo/KailoList';
import TreeTitle from './home/TreeTitle';
import useKailoText from '@/utils/kailoI18n';
import { KailoUserView } from '@/components/kailo/KailoUser';

export interface ThreadData {
  id: string;
  name: string;
  owner?: KailoUserView | null;
  canManage?: boolean;
}

export interface Props {
  data: {
    threads: ThreadData[];
  };
  pane?: {
    total: number;
    page: number;
    pages: number;
    loading: boolean;
    refreshing: boolean;
    error?: unknown;
    setPage: (page: number) => void;
    retry: () => void;
    newThreadPath: { pathname: string; query: Record<string, string> };
  };
  onSelect: (selectKeys) => void;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, newName: string) => Promise<void>;
}

// DD-167 (`20` §13.2 列表窗格, §15.1): the thread pane of 问答. Header 40
// (Overline title, count, one icon button "新建对话"), rows 32 (Callout,
// selected brand-soft), the compact pager "‹ x / y ›" at the bottom; first
// read as skeleton rows, a failed read only affects the pane. The dashboard
// is a page header tab, not a pane row. Styles: controls.less §25.
export default function Home(props: Props) {
  const { data, pane, onSelect, onRename, onDelete } = props;
  const router = useRouter();
  const t = useKailoText();
  const params = useParams<{ id: string }>();
  const threads = data?.threads || [];
  const selected = params?.id ? String(params.id) : undefined;

  const onDeleteThread = async (threadId: string) => {
    try {
      await onDelete(threadId);
      if (selected === threadId) router.push(pane?.newThreadPath || '/home');
    } catch (error) {
      console.error(error);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter') onSelect([threads[index].id]);
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const rows =
      event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
        '.kailo-pane__row',
      );
    const next = index + (event.key === 'ArrowDown' ? 1 : -1);
    rows?.[Math.max(0, Math.min((rows?.length || 1) - 1, next))]?.focus();
  };

  const body = () => {
    if (pane?.loading) return <KailoPaneSkeleton />;
    if (pane?.error)
      return (
        <KailoLoadError
          compact
          error={pane.error}
          item="list.itemThreads"
          onRetry={pane.retry}
        />
      );
    if (threads.length === 0)
      return (
        <div className="kailo-pane__empty">
          <div className="kailo-pane__empty-title">
            {t('list.threadsEmpty')}
          </div>
          <div className="kailo-pane__empty-hint">
            {t('list.threadsEmptyHint')}
          </div>
        </div>
      );
    return (
      <div
        role="listbox"
        aria-label={t('list.threadsPane')}
        className={clsx('kailo-pane__rows', {
          'kailo-pane__rows--refreshing': pane?.refreshing,
        })}
      >
        {threads.map((thread, index) => (
          <div
            key={thread.id}
            role="option"
            tabIndex={0}
            aria-selected={selected === thread.id}
            className={clsx('kailo-pane__row', {
              'kailo-pane__row--selected': selected === thread.id,
            })}
            onClick={() => onSelect([thread.id])}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <TreeTitle
              id={thread.id}
              title={thread.name}
              owner={thread.owner}
              canManage={thread.canManage}
              onRename={onRename}
              onDelete={onDeleteThread}
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <section className="kailo-pane" aria-label={t('list.threadsPane')}>
      <header className="kailo-pane__head">
        <span className="kailo-pane__title">{t('list.threadsPane')}</span>
        {pane && !pane.loading && !pane.error && (
          <span
            className="kailo-pane__count"
            title={t('list.threadsPaneCount', { total: pane.total })}
          >
            {pane.total}
          </span>
        )}
        <Tooltip title={t('newConversationAction')} mouseEnterDelay={0.4}>
          <Button
            type="text"
            size="small"
            className="kailo-pane__action"
            aria-label={t('newConversationAction')}
            icon={<PlusIcon />}
            onClick={() => router.push(pane?.newThreadPath || '/home')}
          />
        </Tooltip>
      </header>
      <KailoListProgress active={!!pane?.refreshing} />
      <div className="kailo-pane__body">{body()}</div>
      {pane && pane.pages > 1 && (
        <footer className="kailo-pane__foot">
          <KailoPanePager
            page={pane.page}
            pages={pane.pages}
            onChange={pane.setPage}
          />
        </footer>
      )}
    </section>
  );
}
