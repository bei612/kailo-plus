// Original Buzz public profile presentation; Pulse host supplies real Community data.
import type { LucideIcon } from "lucide-react";
import { translate, type PlatformLocale } from "@client-kit/platform/i18n";
import { useUiLocale } from "@client-kit/platform/react/context";
import { Fingerprint, UserRound } from "lucide-react";
import type * as React from "react";

import type { UserProfileSummary as Profile } from "./host";
import { canonicalNpub, truncateNpub } from "../conversations/pubkey";
import {
  HoverCopyIndicator,
  useCopyFeedback,
} from "./HoverCopyIndicator";
import { PanelSectionGroup } from "./PanelSectionGroup";
import { PubKey } from "../conversations/pubkey-view";

export type ProfileField = {
  copyValue?: string;
  displayValue: string;
  displayNode?: React.ReactNode;
  icon: LucideIcon;
  label: string;
  testId: string;
};

export function buildPublicFields({
  profile,
  pubkey,
  locale,
}: {
  profile: Pick<Profile, "nip05Handle"> | undefined;
  pubkey: string;
  locale: PlatformLocale;
}): ProfileField[] {
  const npub = canonicalNpub(pubkey);
  const fields: ProfileField[] = [
    {
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
      label: translate(locale, "platform.profile.publicKey"),
      testId: "user-profile-public-key",
    },
  ];

  if (profile?.nip05Handle) {
    fields.push({
      copyValue: profile.nip05Handle,
      displayValue: profile.nip05Handle,
      icon: UserRound,
      label: "NIP-05",
      testId: "user-profile-nip05",
    });
  }

  return fields;
}

export function ProfileFieldGroup({ fields, copy }: { fields: ProfileField[]; copy: (value: string) => Promise<void> }) {
  return (
    <PanelSectionGroup>
      <div className="divide-y divide-border/55">
        {fields.map((field) => (
          <ProfileFieldRow field={field} copyText={copy} key={field.testId} />
        ))}
      </div>
    </PanelSectionGroup>
  );
}

function ProfileFieldRow({ field, copyText }: { field: ProfileField; copyText: (value: string) => Promise<void> }) {
  const locale = useUiLocale();
  const Icon = field.icon;
  const { copied, copy } = useCopyFeedback({
    label: field.label,
    value: field.copyValue ?? "",
    writeTextToClipboard: copyText,
  });

  const content = (
    <>
      <Icon
        className="h-4 w-4 shrink-0 text-muted-foreground"
        data-slot="profile-field-icon"
      />
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium text-foreground">
          {field.label}
        </span>
        <span
          className="mt-0.5 block truncate text-sm text-muted-foreground/70"
          title={field.displayValue}
        >
          {field.displayNode ?? field.displayValue}
        </span>
      </span>
      {field.copyValue ? (
        <HoverCopyIndicator
          copied={copied}
          testId={`${field.testId}-copy-status`}
        />
      ) : null}
    </>
  );

  if (field.copyValue) {
    return (
      <button
        aria-label={translate(locale, "platform.profile.copyField", { field: field.label })}
        className="group flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid={field.testId}
        onClick={() => void copy()}
        title={translate(locale, "platform.profile.copyField", { field: field.label })}
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
