import { createBrowserHistory, createRouter } from "@tanstack/react-router";

import { routeTree } from "@/app/routeTree.gen";

export const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL.replace(/\/$/, "") || "/",
  history: createBrowserHistory(),
  scrollRestoration: true,
  getScrollRestorationKey: (location: { pathname: string }) => location.pathname,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
