import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { Dropdown, Menu } from 'antd';
import { MoreHorizontalIcon, PencilIcon } from '@/components/kailo/KailoIcons';
import useKailoText from '@/utils/kailoI18n';
import LabelTitle from '@/components/sidebar/LabelTitle';
import { DeleteThreadModal } from '@/components/modals/DeleteModal';
import KailoUser, { KailoUserView } from '@/components/kailo/KailoUser';
import { prompt } from '@/utils/kailoHost';

const MENU_ITEM_KEYS = {
  RENAME: 'rename',
  DELETE: 'delete',
};

const StyledMenu = styled(Menu)`
  a:hover {
    color: inherit;
  }
`;

const MoreButton = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--kailo-color-muted-foreground);
  cursor: pointer;
  &:hover {
    background-color: var(--kailo-color-pressed);
    color: var(--kailo-color-foreground);
  }
`;

interface TreeTitleProps {
  id: string;
  title: string;
  owner?: KailoUserView | null;
  canManage?: boolean;
  onDelete?: (id: string) => void;
  onRename?: (id: string, newName: string) => void;
}

export default function TreeTitle(props: TreeTitleProps) {
  const { id, onDelete, onRename, owner, canManage = true } = props;
  const t = useKailoText();
  // DD-133 §3: the thread's Kailo creator, as avatar with the name on hover.
  const ownerMark = owner ? (
    <KailoUser user={owner} size={16} showName={false} className="mr-1" />
  ) : null;
  const [title, setTitle] = useState(props.title);
  useEffect(() => setTitle(props.title), [props.title]);

  // DD-167 (`07` §4.8.10): the new name is asked in Kailo's prompt dialog
  // (the page's own Kailo-styled dialog at top level).
  const onRenameThread = async () => {
    const name = await prompt({
      title: t('list.renameThread'),
      label: t('list.renameLabel'),
      value: title,
      confirmLabel: t('list.renameConfirm'),
      maxLength: 255,
    });
    if (!name || name === title) return;
    setTitle(name);
    onRename && onRename(id, name);
  };

  const onDeleteData = (id: string) => {
    onDelete && onDelete(id);
  };

  return !canManage ? (
    <LabelTitle title={title} appendIcon={ownerMark} />
  ) : (
    <LabelTitle
      title={title}
      appendIcon={
        <>
          {ownerMark}
          <Dropdown
            trigger={['click']}
            overlayStyle={{ userSelect: 'none', minWidth: 150 }}
            overlay={
              <StyledMenu
                items={[
                  {
                    label: (
                      <>
                        <PencilIcon className="mr-2" />
                        {t('home.rename')}
                      </>
                    ),
                    key: MENU_ITEM_KEYS.RENAME,
                    onClick: ({ domEvent }) => {
                      domEvent.stopPropagation();
                      void onRenameThread();
                    },
                  },
                  {
                    label: (
                      <DeleteThreadModal
                        name={
                          title.length > 40 ? `${title.slice(0, 39)}…` : title
                        }
                        onConfirm={() => onDeleteData(id)}
                      />
                    ),
                    key: MENU_ITEM_KEYS.DELETE,
                    onClick: ({ domEvent }) => {
                      domEvent.stopPropagation();
                    },
                  },
                ]}
              />
            }
          >
            <MoreButton
              role="button"
              aria-label={t('home.moreActions')}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontalIcon />
            </MoreButton>
          </Dropdown>
        </>
      }
    />
  );
}
