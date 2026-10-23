import { useState } from 'react';
import { Button, Modal, Select, Typography, message } from 'antd';
import ShareAltOutlined from '@ant-design/icons/ShareAltOutlined';
import { v4 as uuidv4 } from 'uuid';
import useKailoSession from '@/hooks/useKailoSession';
import useKailoText from '@/utils/kailoI18n';
import KailoUser from '@/components/kailo/KailoUser';
import {
  useKailoShareMembersQuery,
  useShareWithMembersMutation,
} from '@/apollo/client/graphql/kailo.generated';
import { KailoShareTargetInput } from '@/apollo/client/graphql/__types__';

// DD-138(4), `07` §4.8.3: "分享给成员 / Share with member". Picks current
// Kailo Tenant members (the applied Core member directory, without the
// caller) and sends each a SHARED notification to the Kailo inbox. It grants
// nothing: every member can already open threads and the team dashboard.
// Shown only when delivery is configured (Kailo mode). Antd components with
// the Kailo theme overlay only; no colours of its own.

interface Props {
  target: KailoShareTargetInput;
  className?: string;
}

export function KailoShareButton({ target, className }: Props) {
  const t = useKailoText();
  const { shareAvailable, user } = useKailoSession();
  const [open, setOpen] = useState(false);
  if (!shareAvailable || !user) return null;
  return (
    <>
      <Button
        size="small"
        icon={<ShareAltOutlined />}
        className={className}
        onClick={() => setOpen(true)}
      >
        {t('shareWithMember')}
      </Button>
      {open && (
        <KailoShareModal target={target} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function KailoShareModal(props: {
  target: KailoShareTargetInput;
  onClose: () => void;
}) {
  const { target, onClose } = props;
  const t = useKailoText();
  const [selected, setSelected] = useState<string[]>([]);
  // One id per opened dialog: re-submitting after an error is the same share
  // event for Core (idempotent), not a second notification.
  const [requestId] = useState(() => uuidv4());
  const { data, loading } = useKailoShareMembersQuery({
    fetchPolicy: 'network-only',
  });
  const [share, { loading: sharing }] = useShareWithMembersMutation();
  const members = data?.kailoShareMembers || [];

  const onOk = async () => {
    try {
      await share({
        variables: { data: { target, recipients: selected, requestId } },
      });
      message.success(t('shareDone'));
      onClose();
    } catch {
      message.error(t('shareFailed'));
    }
  };

  return (
    <Modal
      visible
      centered
      destroyOnClose
      title={t(target.dashboard ? 'shareDashboardTitle' : 'shareThreadTitle')}
      okText={t('shareSubmit')}
      cancelText={t('shareCancel')}
      okButtonProps={{ disabled: !selected.length, loading: sharing }}
      onOk={onOk}
      onCancel={onClose}
    >
      <Typography.Paragraph type="secondary">{t('shareHint')}</Typography.Paragraph>
      <Select
        mode="multiple"
        style={{ width: '100%' }}
        loading={loading}
        value={selected}
        onChange={(value: string[]) => setSelected(value)}
        placeholder={t('shareMembersPlaceholder')}
        notFoundContent={loading ? undefined : t('shareNoMembers')}
        optionFilterProp="label"
        optionLabelProp="label"
        maxTagCount={8}
      >
        {members.map((member) => (
          <Select.Option
            key={member.userKey}
            value={member.userKey}
            label={member.name || '—'}
          >
            <KailoUser
              user={{ name: member.name || '—', picture: member.picture }}
              size={20}
            />
          </Select.Option>
        ))}
      </Select>
    </Modal>
  );
}

export default KailoShareButton;
