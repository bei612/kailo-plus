import { useState } from 'react';
import styled from 'styled-components';
import { Dropdown, Menu } from 'antd';
import EditOutlined from '@ant-design/icons/EditOutlined';
import MoreOutlined from '@ant-design/icons/MoreOutlined';
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
    color: white;
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
                        <EditOutlined className="mr-2" />
                        Rename
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
                      <DeleteThreadModal onConfirm={() => onDeleteData(id)} />
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
            <MoreOutlined onClick={(event) => event.stopPropagation()} />
          </Dropdown>
        </>
      }
    />
  );
}
