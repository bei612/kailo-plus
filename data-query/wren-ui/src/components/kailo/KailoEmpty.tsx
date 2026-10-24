import { ComponentType, ReactNode } from 'react';
import { Button } from 'antd';
import { InboxIcon, KailoIconProps } from './KailoIcons';

// DD-152 (20 §13 空态): centred 64px line illustration in brand colour,
// title 17/24 600, description 14 muted, at most one primary action.
interface Props {
  icon?: ComponentType<KailoIconProps>;
  title: string;
  description?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export default function KailoEmpty({
  icon: Icon = InboxIcon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: Props) {
  return (
    <div className={`kailo-empty${className ? ` ${className}` : ''}`}>
      <Icon size={64} strokeWidth={1.5} className="kailo-empty__icon" />
      <div className="kailo-empty__title">{title}</div>
      {description && (
        <div className="kailo-empty__description">{description}</div>
      )}
      {actionLabel && onAction && (
        <Button type="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
