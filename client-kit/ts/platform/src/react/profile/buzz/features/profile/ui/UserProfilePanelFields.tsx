// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/ui/UserProfilePanelFields.tsx: Agent profile field model,
// buckets, ordering and rows.
// Kailo differences, each with its design basis:
// - Labels are localized (REQ-08), so buckets and ordering key on a stable field key instead of
//   the original English label.
// - DD-117(6): public fields read the Relay kind:0 only. The Relay agent directory fields
//   ("Agent type", "Capabilities") have no Kailo source (no 24200 heartbeat, DD-125(6)).
// - 17 §8 / DD-125(6): owner and operational fields come from the admitted Installation:
//   "Managed by" is its HUMAN owner, "Runtime" its RuntimeProfile key, "Status" its state and
//   "Who can send instructions" the use-authorization mapping of the original respondTo.
// - DD-26: local process fields ("ACP command", "MCP command", "Backend", "Start on launch",
//   "Last error" of a local harness) have no object and are not rendered.
import {
  AgentInstallationState,
  AgentRespondToMode,
  type AgentInstallationView,
} from "@client-kit/contracts";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowUpRight,
  Ear,
  Fingerprint,
  Terminal,
  UserRound,
} from "lucide-react";
import * as React from "react";

import { installationLabels } from "../../../../../agent-installation-view";
import { useClipboardWrite, useUiT, type Translate } from "../../../../../context";
import { canonicalNpub, truncateNpub } from "../../../../../conversations/pubkey";
import { PubKey } from "../../../../../conversations/pubkey-view";
import {
  HoverCopyIndicator,
  useCopyFeedback,
} from "../../../../../pulse/HoverCopyIndicator";
import { PanelSectionGroup } from "../../../../../pulse/PanelSectionGroup";
import { cn } from "../../../shared/lib/cn";

export type ProfileFieldKey =
  | "publicKey"
  | "nip05"
  | "managedBy"
  | "runtime"
  | "respondTo"
  | "status";

export type ProfileField = {
  key: ProfileFieldKey;
  copyValue?: string;
  displayValue: string;
  displayNode?: React.ReactNode;
  icon?: LucideIcon;
  label: string;
  onClick?: () => void;
  testId?: string;
  trailingNode?: React.ReactNode;
};

const AGENT_INFO_KEYS = new Set<ProfileFieldKey>([
  "publicKey",
  "managedBy",
  "nip05",
]);
const AGENT_SETTINGS_KEYS = new Set<ProfileFieldKey>(["runtime", "respondTo"]);
const DIAGNOSTICS_KEYS = new Set<ProfileFieldKey>(["status"]);

export function bucketProfileFields(fields: ProfileField[]) {
  return {
    agentInfoFields: fields.filter((field) => AGENT_INFO_KEYS.has(field.key)),
    agentSettingsFields: fields.filter((field) =>
      AGENT_SETTINGS_KEYS.has(field.key),
    ),
    diagnosticsFields: fields.filter((field) =>
      DIAGNOSTICS_KEYS.has(field.key),
    ),
  };
}

export function useProfileFieldBuckets({
  installation,
  isOwner,
  onOpenProfile,
  ownerDisplayName,
  ownerPubkey,
  profile,
  pubkey,
  respondTo,
}: {
  installation: AgentInstallationView;
  isOwner: boolean;
  onOpenProfile?: (pubkey: string) => void;
  ownerDisplayName: string | null;
  ownerPubkey: string | null;
  profile: { nip05Handle?: string | null } | undefined;
  pubkey: string;
  /** The original respondTo mapped onto use authorization; undefined when not read. */
  respondTo: AgentRespondToMode | undefined;
}) {
  const t = useUiT();
  return React.useMemo(() => {
    const metadataFields = [
      ...buildPublicFields({ profile, pubkey, t }),
      ...(ownerDisplayName || isOwner
        ? buildOwnerFields({
            includeOperationalFields: isOwner,
            installation,
            onOpenProfile,
            ownerDisplayName,
            ownerPubkey,
            respondTo,
            t,
          })
        : []),
    ];
    return bucketProfileFields(metadataFields);
  }, [
    installation,
    isOwner,
    onOpenProfile,
    ownerDisplayName,
    ownerPubkey,
    profile,
    pubkey,
    respondTo,
    t,
  ]);
}

export function buildPublicFields({
  profile,
  pubkey,
  t,
}: {
  profile: { nip05Handle?: string | null } | undefined;
  pubkey: string;
  t: Translate;
}): ProfileField[] {
  const fields: ProfileField[] = [];
  const npub = canonicalNpub(pubkey);
  fields.push({
    key: "publicKey",
    // Copy the full canonical npub; an identity that cannot be encoded is
    // never copyable.
    copyValue: npub ?? undefined,
    displayValue: truncateNpub(pubkey),
    displayNode: (
      <PubKey
        interactive={false}
        pubkey={pubkey}
        testId="user-profile-copy-pubkey"
      />
    ),
    icon: Fingerprint,
    label: t("platform.profile.publicKey"),
    testId: "user-profile-public-key",
  });

  if (profile?.nip05Handle) {
    fields.push({
      key: "nip05",
      copyValue: profile.nip05Handle,
      displayValue: profile.nip05Handle,
      icon: UserRound,
      label: "NIP-05",
      testId: "user-profile-nip05",
    });
  }

  return fields;
}

/** Original AgentStatusBadge wording over the recorded Installation state. */
function installationStatusKey(installation: Pick<AgentInstallationView, "state">) {
  switch (installation.state) {
    case AgentInstallationState.Active:
      return "agentLifecycle.status.running" as const;
    case AgentInstallationState.Disabled:
      return "agentLifecycle.status.stopped" as const;
    default:
      return installationLabels[installation.state];
  }
}

export function buildOwnerFields({
  includeOperationalFields,
  installation,
  onOpenProfile,
  ownerDisplayName,
  ownerPubkey,
  respondTo,
  t,
}: {
  includeOperationalFields: boolean;
  installation: AgentInstallationView;
  onOpenProfile?: (pubkey: string) => void;
  ownerDisplayName: string | null;
  ownerPubkey: string | null;
  respondTo: AgentRespondToMode | undefined;
  t: Translate;
}): ProfileField[] {
  const fields: ProfileField[] = [];
  const respondToDisplayValue =
    respondTo === undefined
      ? null
      : respondTo === AgentRespondToMode.OwnerOnly
        ? ownerDisplayName
          ? t("platform.profile.respondTo.ownerOnlyNamed", { name: ownerDisplayName })
          : t("platform.profile.respondTo.ownerOnly")
        : t("platform.profile.respondTo.allowlist");

  const ownerClickable = Boolean(onOpenProfile && ownerPubkey);
  // Non-clickable owner rows copy the owner's full npub; an unencodable owner
  // key copies nothing.
  const ownerCopyValue = ownerClickable
    ? undefined
    : ownerPubkey
      ? (canonicalNpub(ownerPubkey) ?? undefined)
      : undefined;

  if (ownerDisplayName) {
    fields.push({
      key: "managedBy",
      copyValue: ownerCopyValue,
      displayValue: ownerDisplayName,
      displayNode: <span className="truncate">{ownerDisplayName}</span>,
      icon: UserRound,
      label: t("platform.profile.field.managedBy"),
      onClick:
        ownerClickable && ownerPubkey
          ? () => onOpenProfile?.(ownerPubkey)
          : undefined,
      testId: "user-profile-managed-by",
    });
  }

  if (!includeOperationalFields) {
    return fields;
  }

  const runtimeProfileKey = installation.projection?.runtimeProfileKey;
  if (runtimeProfileKey) {
    fields.push({
      key: "runtime",
      copyValue: runtimeProfileKey,
      displayValue: runtimeProfileKey,
      icon: Terminal,
      label: t("platform.profile.section.runtime"),
      testId: "user-profile-runtime",
    });
  }

  const active = installation.state === AgentInstallationState.Active;
  const statusLabel = t(installationStatusKey(installation));
  fields.push({
    key: "status",
    displayValue: statusLabel,
    displayNode: (
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
          active
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground",
        )}
        data-testid="user-profile-agent-status-badge"
      >
        {statusLabel}
      </span>
    ),
    icon: Activity,
    label: t("platform.profile.field.status"),
    testId: "user-profile-agent-status",
  });

  if (respondToDisplayValue) {
    fields.push({
      key: "respondTo",
      displayValue: respondToDisplayValue,
      icon: Ear,
      label: t("platform.profile.field.respondTo"),
      testId: "user-profile-respond-to",
    });
  }

  return fields;
}

function orderProfileFields(fields: ProfileField[]) {
  return [
    ...fields.filter((field) => field.key === "publicKey"),
    ...fields.filter((field) => field.key === "managedBy"),
    ...fields.filter(
      (field) =>
        field.key !== "publicKey" &&
        field.key !== "managedBy" &&
        field.copyValue,
    ),
    ...fields.filter((field) => field.key === "status"),
    ...fields.filter((field) => {
      if (
        field.key === "publicKey" ||
        field.key === "managedBy" ||
        field.key === "status"
      ) {
        return false;
      }
      return !field.copyValue;
    }),
  ];
}

export function ProfileFieldRows({
  fields,
  variant = "default",
}: {
  fields: ProfileField[];
  variant?: "default" | "runtime";
}) {
  return (
    <>
      {orderProfileFields(fields).map((field) => (
        <ProfileFieldRow
          field={field}
          key={field.testId ?? field.key}
          variant={variant}
        />
      ))}
    </>
  );
}

export function ProfileSectionGroup({
  children,
  headerAction,
  testId,
  title,
}: {
  children: React.ReactNode;
  headerAction?: React.ReactNode;
  testId?: string;
  title?: string;
}) {
  return (
    <PanelSectionGroup
      headerAction={headerAction}
      testId={testId}
      title={title}
    >
      <div className="divide-y divide-border/55">{children}</div>
    </PanelSectionGroup>
  );
}

export function ProfileFieldGroup({
  fields,
  title,
}: {
  fields: ProfileField[];
  title?: string;
}) {
  return (
    <ProfileSectionGroup title={title}>
      <ProfileFieldRows fields={fields} />
    </ProfileSectionGroup>
  );
}

function ProfileFieldRow({
  field,
  variant,
}: {
  field: ProfileField;
  variant: "default" | "runtime";
}) {
  const t = useUiT();
  const writeTextToClipboard = useClipboardWrite();
  const Icon = field.icon;
  const isCopyable = Boolean(field.copyValue);
  const isActionable = Boolean(field.onClick);
  const isTrailingDisplay =
    variant === "runtime" && field.key === "status" && field.displayNode;
  const { copied, copy } = useCopyFeedback({
    label: field.label,
    value: field.copyValue ?? "",
    writeTextToClipboard,
  });

  const content = (
    <>
      {Icon ? (
        <Icon
          className="h-4 w-4 shrink-0 text-muted-foreground"
          data-slot="profile-field-icon"
        />
      ) : null}
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium text-foreground">
          {field.label}
        </span>
        {!isTrailingDisplay ? (
          <span
            className="mt-0.5 block truncate text-sm text-muted-foreground/70"
            title={field.displayValue}
          >
            {field.displayNode ?? field.displayValue}
          </span>
        ) : null}
      </span>
      {isTrailingDisplay ? field.displayNode : null}
      {field.trailingNode}
      {isActionable ? (
        <ArrowUpRight
          className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          data-testid={
            field.testId ? `${field.testId}-action-indicator` : undefined
          }
        />
      ) : isCopyable ? (
        <HoverCopyIndicator
          copied={copied}
          testId={field.testId ? `${field.testId}-copy-status` : undefined}
        />
      ) : null}
    </>
  );

  if (isActionable) {
    return (
      <button
        aria-label={t("platform.profile.openField", { field: field.label })}
        className="group flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid={field.testId}
        onClick={field.onClick}
        title={t("platform.profile.openField", { field: field.label })}
        type="button"
      >
        {content}
      </button>
    );
  }

  if (isCopyable && field.copyValue) {
    return (
      <button
        aria-label={t("platform.profile.copyField", { field: field.label })}
        className="group flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid={field.testId}
        onClick={() => void copy()}
        title={t("platform.profile.copyField", { field: field.label })}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className="flex min-h-16 items-center gap-3 px-4 py-3"
      data-testid={field.testId}
    >
      {content}
    </div>
  );
}
