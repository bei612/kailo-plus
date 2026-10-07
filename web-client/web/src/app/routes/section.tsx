import { createFileRoute, notFound } from "@tanstack/react-router";
import { isPlatformSection } from "@/app/platform-navigation";

export const Route = createFileRoute("/_platform/$section")({
  params: { parse: ({ section }) => {
    if (!isPlatformSection(section)) throw notFound();
    return { section };
  } },
});
