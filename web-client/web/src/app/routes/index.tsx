import { createFileRoute } from "@tanstack/react-router";

// The parent host resolves the normal default Workspace through the fresh BFF directory.
export const Route = createFileRoute("/_platform/")({});
