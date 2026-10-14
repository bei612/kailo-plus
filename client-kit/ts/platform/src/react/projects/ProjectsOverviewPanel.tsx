// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectsOverviewPanel.tsx::ProjectsOverviewPanel
// and ProjectsActivityIntro; wording comes from the shared catalog.
import type * as React from "react";

import { useUiT } from "../context";
import type { ProjectsActivityDigest } from "./lib/projectsActivityDigest";

type ProjectsOverviewPanelProps = {
  children: React.ReactNode;
};

export function ProjectsOverviewPanel({
  children,
}: ProjectsOverviewPanelProps) {
  return (
    <section data-testid="projects-overview-panel">
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function ProjectsActivityIntro({
  digest,
}: {
  digest: ProjectsActivityDigest;
}) {
  const t = useUiT();
  return (
    <section
      className="pb-6 pt-8 text-left"
      data-testid="projects-activity-intro"
    >
      <h2
        className="text-xl font-semibold tracking-tight text-foreground"
        data-testid="projects-page-header"
      >
        {t("projects.activity.title")}
      </h2>
      <p
        className="mt-2 max-w-2xl text-sm text-muted-foreground"
        data-testid="projects-activity-summary"
      >
        {digest.prefix}{" "}
        {digest.highlights.map((highlight, index) => (
          <span key={highlight}>
            {index > 0
              ? index === digest.highlights.length - 1
                ? t("projects.activity.digest.and")
                : t("projects.discussion.separator")
              : null}
            <strong className="font-medium text-foreground/90">
              {highlight}
            </strong>
          </span>
        ))}
        {digest.suffix}
      </p>
    </section>
  );
}
