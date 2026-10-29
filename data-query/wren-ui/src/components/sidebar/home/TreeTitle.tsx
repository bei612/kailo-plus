import { useState } from 'react';
import styled from 'styled-components';
import { Dropdown, Menu } from 'antd';
import { MoreHorizontalIcon, PencilIcon } from '@/components/kailo/KailoIcons';
import useKailoText from '@/utils/kailoI18n';
import LabelTitle from '@/components/sidebar/LabelTitle';
import TreeTitleInput from '@/components/sidebar/home/TreeTitleInput';
import { DeleteThreadModal } from '@/components/modals/DeleteModal';
import KailoUser, { KailoUserView } from '@/components/kailo/KailoUser';

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
  const [isEditing, setIsEditing] = useState(false);

  const onCancelChange = () => {
    setIsEditing(false);
    setTitle(props.title);
  };

  const onChangeTitle = (newThreadTitle: string) => {
    setIsEditing(false);
    setTitle(newThreadTitle);
    onRename && onRename(id, newThreadTitle);
  };

  const onDeleteData = (id: string) => {
    onDelete && onDelete(id);
  };

  return isEditing ? (
    <TreeTitleInput
      title={title}
      onCancelChange={onCancelChange}
      onSetTitle={setTitle}
      onRename={onChangeTitle}
    />
  ) : !canManage ? (
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
                      setIsEditing(true);
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
