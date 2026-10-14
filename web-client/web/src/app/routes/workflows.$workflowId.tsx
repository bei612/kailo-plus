import { createFileRoute } from "@tanstack/react-router";

// Buzz 779af8886caae1317b4de962082429867ab61503 app/routes/workflows.$workflowId.tsx:
// the URL-addressable workflow target. The shared page proves it through the
// existing authorized automation read; the URL grants nothing.
export const Route = createFileRoute("/_platform/workflows/$workflowId")({});
