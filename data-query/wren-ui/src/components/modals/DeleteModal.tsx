import { ButtonProps, ModalProps } from 'antd';
import { TrashIcon } from '@/components/kailo/KailoIcons';
import useKailoText, { KailoTextKey } from '@/utils/kailoI18n';
import { confirmDanger } from '@/utils/kailoHost';

// DD-152 (20 §13.8 确认): destructive actions are confirmed in Kailo's dialog
// (KailoEmbed.confirm, tone danger): a question as the title, the
// consequence as the description, "删除" / "取消". At top level the page shows
// the same dialog itself (kailoHost.confirm).

type DeleteModalProps = {
  disabled?: boolean;
  /** Ignored since DD-152: the dialog is Kailo's. Kept for callers. */
  modalProps?: ModalProps;
  onConfirm: () => unknown;
  /** Shown in the title: 删除对话「名称」？ */
  name?: string;
  style?: any;
} & Partial<ButtonProps>;

type Config = {
  item?: KailoTextKey;
  description?: KailoTextKey;
};

export const makeDeleteModal =
  (Component, config: Config = {}) =>
  (props: DeleteModalProps) => {
    const t = useKailoText();
    const {
      title: _title,
      content: _content,
      modalProps: _modalProps,
      onConfirm,
      name,
      ...restProps
    } = props as DeleteModalProps & { content?: unknown };
    const item = t(config.item || 'itemDashboardItem');

    return (
      <Component
        icon={<TrashIcon className="mr-2" />}
        onClick={() => {
          if (props.disabled) return;
          void confirmDanger(
            {
              title: name
                ? t('deleteNamedTitle', { item, name })
                : t('deleteTitle', { item }),
              description: t(config.description || 'deleteDescription'),
              confirmLabel: t('delete'),
              cancelLabel: t('cancel'),
            },
            onConfirm,
          );
        }}
        {...restProps}
      />
    );
  };

const DefaultDeleteButton = (props) => {
  const t = useKailoText();
  const { icon = null, disabled, ...restProps } = props;
  return (
    <a className={disabled ? '' : 'kailo-text-danger'} {...restProps}>
      {icon}
      {t('delete')}
    </a>
  );
};

export default makeDeleteModal(DefaultDeleteButton);

export const DeleteThreadModal = makeDeleteModal(DefaultDeleteButton, {
  item: 'itemThread',
  description: 'deleteThreadDescription',
});

export const DeleteViewModal = makeDeleteModal(DefaultDeleteButton, {
  item: 'itemView',
});

export const DeleteModelModal = makeDeleteModal(DefaultDeleteButton, {
  item: 'itemModel',
});

export const DeleteCalculatedFieldModal = makeDeleteModal(DefaultDeleteButton, {
  item: 'itemCalculatedField',
});

export const DeleteRelationshipModal = makeDeleteModal(DefaultDeleteButton, {
  item: 'itemRelationship',
});

export const DeleteDashboardItemModal = makeDeleteModal(DefaultDeleteButton, {
  item: 'itemDashboardItem',
});

export const DeleteQuestionSQLPairModal = makeDeleteModal(DefaultDeleteButton, {
  item: 'itemQuestionSqlPair',
});

export const DeleteInstructionModal = makeDeleteModal(DefaultDeleteButton, {
  item: 'itemInstruction',
});
