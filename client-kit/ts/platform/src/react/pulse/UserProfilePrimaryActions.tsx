// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/ui/UserProfilePrimaryActions.tsx:
// original action group/tile, Message and Follow branches. Hosts supply only admitted actions.
// DD-125(5): Follow writes the Principal follow list in Core CollaborationUserState, not kind 3.
import { MessageSquare, UserMinus, UserPlus, type LucideIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Spinner } from "../profile/buzz/shared/ui/spinner";

export type ProfileFollowAction = { isFollowing: boolean; pending: boolean; onToggle: () => void };

export function ProfilePrimaryActions({onMessage,messagePending,follow}: {
  onMessage?:()=>void; messagePending?:boolean;
  /** Original showFollowAction branch; absent when the host or the "pulse" feature does not offer it. */
  follow?:ProfileFollowAction;
}) {
  const t=useUiT();
  if (!onMessage && !follow) return null;
  return <ProfileActionGroup concealed={false}>
    {onMessage ? <ProfileActionTile disabled={messagePending} icon={MessageSquare} isLoading={messagePending}
      label={t("platform.profile.message")} onClick={onMessage} testId="user-profile-message"/> : null}
    {follow ? <ProfileActionTile active={follow.isFollowing} disabled={follow.pending}
      icon={follow.isFollowing ? UserMinus : UserPlus}
      label={t(follow.isFollowing ? "platform.profile.unfollow" : "platform.profile.follow")}
      onClick={follow.onToggle} testId="user-profile-follow"/> : null}
  </ProfileActionGroup>;
}

function ProfileActionGroup({children,className,concealed,ref}: {
  children:ReactNode; className?:string; concealed:boolean; ref?:Ref<HTMLDivElement>;
}) {
  return <div aria-hidden={concealed || undefined}
    className={cn("grid grid-flow-col auto-cols-fr gap-2",className)}
    data-testid="user-profile-primary-actions" inert={concealed || undefined} ref={ref}>
    {children}
  </div>;
}

function ProfileActionTile({active,disabled,icon:Icon,isLoading,label,onClick,testId,title}: {
  active?:boolean; disabled?:boolean; icon:LucideIcon; isLoading?:boolean;
  label:string; onClick:()=>void; testId?:string; title?:string;
}) {
  return <button aria-label={label} aria-busy={isLoading || undefined}
    className={cn(
      "flex min-h-20 w-full flex-col items-center justify-center gap-1.5 rounded-xl bg-muted px-2 py-3 text-center transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      active && "bg-foreground text-background hover:bg-foreground/90",
    )}
    data-testid={testId} title={title} disabled={disabled} onClick={onClick} type="button">
    {isLoading ? <Spinner aria-hidden="true" className="h-5 w-5 border-2"/> :
      <Icon className={cn("h-5 w-5 text-foreground",active && "text-background")}/>}
    <span className="min-w-0 text-xs font-medium leading-tight">{label}</span>
  </button>;
}
