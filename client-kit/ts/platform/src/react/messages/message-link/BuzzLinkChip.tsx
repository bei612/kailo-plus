// Shared from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/shared/ui/markdown/BuzzLinkChip.tsx.
import * as React from "react";

import { translateCurrent as t } from "../../../i18n";
import { cn } from "../../profile/buzz/shared/lib/cn";
import { InlineChip } from "../system/InlineChip";
import {
  inlineChipIconClasses,
  inlineChipLeadingEnd,
  type InlineChipIconKind,
  truncateInlineChipLabel,
  WRAPPING_INLINE_CHIP_CLASSES,
} from "../../composer/shared/ui/mentionChip";

import {
  MediaContextMenu,
  type MediaContextMenuPosition,
  useDismissMediaContextMenu,
} from "../../image-lightbox/MediaContextMenu";

function useBuzzLinkContextMenu({
  copyLink,
  href,
  interactive,
  onOpenLink,
}: {
  copyLink: (href: string) => void;
  href: string | undefined;
  interactive: boolean;
  onOpenLink: () => void;
}) {
  const [position, setPosition] =
    React.useState<MediaContextMenuPosition | null>(null);
  const closeMenu = React.useCallback(() => setPosition(null), []);
  useDismissMediaContextMenu(Boolean(position), closeMenu);

  const onContextMenuCapture = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!interactive || !href) return;
      event.preventDefault();
      setPosition({ x: event.clientX, y: event.clientY });
    },
    [href, interactive],
  );

  const contextMenu =
    position && href ? (
      <MediaContextMenu
        dataAttributes={["data-buzz-link-context-menu"]}
        items={[
          {
            label: t("messageLink.openLink"),
            onSelect: () => {
              closeMenu();
              onOpenLink();
            },
          },
          {
            label: t("buzz.copyLink"),
            onSelect: () => {
              closeMenu();
              copyLink(href);
            },
          },
        ]}
        position={position}
      />
    ) : null;

  return { contextMenu, onContextMenuCapture };
}

function wrappingChipContent(
  children: React.ReactNode,
  icon: InlineChipIconKind,
): React.ReactNode {
  if (typeof children !== "string" || children.length === 0) return children;

  const leadingEnd = inlineChipLeadingEnd(children);
  if (!leadingEnd) {
    return (
      <>
        <span
          aria-hidden="true"
          className={cn(
            "inline-chip-leading-fragment",
            inlineChipIconClasses(icon),
          )}
        />
        {children}
      </>
    );
  }

  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "inline-chip-leading-fragment",
          inlineChipIconClasses(icon),
        )}
      >
        {children.slice(0, leadingEnd)}
      </span>
      {children.slice(leadingEnd)}
    </>
  );
}

export function BuzzLinkChip({
  children,
  copyLink,
  className,
  href,
  icon: Icon,
  interactive,
  onOpenLink,
  wrapping = false,
  ...props
}: Omit<React.ComponentPropsWithoutRef<"span">, "onClick"> & {
  copyLink: (href: string) => void;
  href?: string;
  icon: InlineChipIconKind;
  interactive: boolean;
  onOpenLink: () => void;
  wrapping?: boolean;
}) {
  const { contextMenu, onContextMenuCapture } = useBuzzLinkContextMenu({
    copyLink,
    href,
    interactive,
    onOpenLink,
  });
  const visibleChildren =
    wrapping && typeof children === "string"
      ? truncateInlineChipLabel(children)
      : children;
  const content = wrapping
    ? wrappingChipContent(visibleChildren, Icon)
    : visibleChildren;
  const chipClassName = cn(className, wrapping && WRAPPING_INLINE_CHIP_CLASSES);
  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLSpanElement>) => {
      props.onKeyDown?.(event);
      if (
        event.defaultPrevented ||
        (event.key !== "Enter" && event.key !== " ")
      ) {
        return;
      }
      event.preventDefault();
      onOpenLink();
    },
    [onOpenLink, props.onKeyDown],
  );

  if (!interactive) {
    return (
      <InlineChip
        {...props}
        data-buzz-link=""
        className={chipClassName}
        icon={Icon}
      >
        {content}
      </InlineChip>
    );
  }

  return (
    <>
      <InlineChip
        {...props}
        data-buzz-link=""
        className={chipClassName}
        icon={Icon}
        interactive
        role="button"
        tabIndex={0}
        onClick={onOpenLink}
        onContextMenuCapture={onContextMenuCapture}
        onKeyDown={onKeyDown}
      >
        {content}
      </InlineChip>
      {contextMenu}
    </>
  );
}

export function BuzzInlineLink({
  children,
  copyLink,
  href,
  interactive,
  onOpenLink,
  ...props
}: Omit<React.ComponentPropsWithoutRef<"button">, "onClick"> & {
  copyLink: (href: string) => void;
  href?: string;
  interactive: boolean;
  onOpenLink: () => void;
}) {
  const contextMenuHref =
    href ?? (typeof props.title === "string" ? props.title : undefined);
  const { contextMenu, onContextMenuCapture } = useBuzzLinkContextMenu({
    copyLink,
    href: contextMenuHref,
    interactive,
    onOpenLink,
  });

  if (!interactive) {
    return <span className="font-medium text-current">{children}</span>;
  }

  return (
    <>
      <button
        {...props}
        type="button"
        className="cursor-pointer font-medium text-primary underline underline-offset-4 transition-colors hover:text-primary/80"
        onClick={onOpenLink}
        onContextMenuCapture={onContextMenuCapture}
      >
        {children}
      </button>
      {contextMenu}
    </>
  );
}
