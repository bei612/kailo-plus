import { useState } from 'react';
import { Tooltip } from 'antd';

// DD-133 §3: a Kailo user shown with the Kailo display name and avatar.
export interface KailoUserView {
  name?: string | null;
  picture?: string | null;
}

interface Props {
  user?: KailoUserView | null;
  size?: number;
  showName?: boolean;
  // Text for rows created before ownership was recorded.
  emptyText?: string;
  className?: string;
}

function initial(name?: string | null) {
  const value = name?.trim();
  return value ? Array.from(value)[0].toUpperCase() : '?';
}

export default function KailoUser(props: Props) {
  const { user, size = 20, showName = true, emptyText, className } = props;
  // 07 §4.7.3: a person without a Kailo avatar answers 404, so a picture that
  // fails to load falls back to the initial instead of a broken image.
  const [failedPicture, setFailedPicture] = useState<string | null>(null);
  if (!user?.name && !user?.picture)
    return emptyText ? (
      <span className={`kailo-user ${className || ''}`}>{emptyText}</span>
    ) : null;
  const picture = user.picture !== failedPicture ? user.picture : null;
  const avatar = picture ? (
    <img
      className="kailo-user__avatar"
      src={picture}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      onError={() => setFailedPicture(picture)}
    />
  ) : (
    <span
      className="kailo-user__avatar"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      aria-hidden
    >
      {initial(user.name)}
    </span>
  );
  const content = (
    <span className={`kailo-user ${className || ''}`}>
      {avatar}
      {showName && user.name && (
        <span className="kailo-user__name">{user.name}</span>
      )}
    </span>
  );
  return showName || !user.name ? (
    content
  ) : (
    <Tooltip title={user.name}>{content}</Tooltip>
  );
}
