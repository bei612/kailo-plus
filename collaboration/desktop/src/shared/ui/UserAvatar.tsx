import { UserAvatar as SharedUserAvatar, type UserAvatarProps } from "@client-kit/platform/react/messages";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";

export function UserAvatar(props: Omit<UserAvatarProps, "resolveMediaUrl">) {
  return <SharedUserAvatar {...props} resolveMediaUrl={rewriteRelayUrl} />;
}
