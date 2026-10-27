import * as React from "react";
import { openProjectEntity, parseEntityLink } from "@client-kit/platform/react/projects";
import { translateCurrent as t } from "@client-kit/platform/i18n";
import { toast } from "sonner";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useProjectsHost } from "@/features/platform/ProjectsScreen";
import { listenForEntityDeepLinks } from "./deep-link";

/** Original OS entity queue, accepted only after current-scope read/navigation. */
export function useEntityDeepLinks() {
  const host = useProjectsHost();
  const {goProject} = useAppNavigation();
  React.useEffect(() => {
    if (!host) return;
    const controller = new AbortController();
    const pending = listenForEntityDeepLinks(async href => {
      if (controller.signal.aborted) return false;
      const parsed = parseEntityLink(href);
      // Invalid/unsupported heads must not wedge subsequent supported links.
      if (!parsed.ok) return true;
      try {
        await openProjectEntity(host, parsed.value, controller.signal, goProject);
        return true;
      } catch {
        if (controller.signal.aborted) return false;
        toast.error(t("platform.loadFailed"));
        return true; // Handled refusal, not successful navigation or retry permission.
      }
    });
    return () => {controller.abort();void pending.then(unlisten=>unlisten());};
  }, [host,goProject]);
}
