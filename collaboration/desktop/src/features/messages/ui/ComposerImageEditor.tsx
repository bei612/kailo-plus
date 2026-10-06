import type { ComponentProps } from "react";
import { ComposerImageEditor as SharedComposerImageEditor } from "@client-kit/platform/react/composer/features/messages/ui/ComposerImageEditor";
import { fetchMediaBytes } from "@/shared/api/tauriMedia";
export function ComposerImageEditor(props: Omit<ComponentProps<typeof SharedComposerImageEditor>, "fetchMediaBytes">) {
  return <SharedComposerImageEditor {...props} fetchMediaBytes={fetchMediaBytes} />;
}
