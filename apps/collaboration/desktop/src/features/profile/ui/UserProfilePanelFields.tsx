import type { LucideIcon } from "lucide-react";
import { Fingerprint, UserRound } from "lucide-react";
import type * as React from "react";

import type { Profile } from "@/shared/api/types";
import { canonicalNpub, truncateNpub } from "@/shared/lib/pubkey";
import {
  HoverCopyIndicator,
  useCopyFeedback,
} from "@/shared/ui/HoverCopyIndicator";
import { PanelSectionGroup } from "@/shared/ui/PanelSectionGroup";
import { PubKey } from "@/shared/ui/PubKey";

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
}: {
  profile: Profile | undefined;
  pubkey: string;
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
      label: "Public key",
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

export function ProfileFieldGroup({ fields }: { fields: ProfileField[] }) {
  return (
    <PanelSectionGroup>
      <div className="divide-y divide-border/55">
        {fields.map((field) => (
          <ProfileFieldRow field={field} key={field.testId} />
        ))}
      </div>
    </PanelSectionGroup>
  );
}

function ProfileFieldRow({ field }: { field: ProfileField }) {
  const Icon = field.icon;
  const { copied, copy } = useCopyFeedback({
    label: field.label,
    value: field.copyValue ?? "",
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
        aria-label={`Copy ${field.label}`}
        className="group flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid={field.testId}
        onClick={() => void copy()}
        title={`Copy ${field.label}`}
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
