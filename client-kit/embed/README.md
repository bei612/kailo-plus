# client-kit/embed — Kailo presentation for component pages (DD-133)

Two files every component page (Cells, WeKnora, Wren, and any later
`NATIVE_PAGE` component) ships inside its own build artifact:

| File | What it is |
|---|---|
| `kailo-theme-tokens.css` | Generated. Kailo's light and dark tokens (`--kailo-*`): colors, font stack, type ramp, radius, elevation. Light on `:root`; dark under `:root[data-kailo-theme="dark"]`. |
| `kailo-embed.js` | Hand-written, dependency-free runtime (wire protocol v1). Sets the initial theme/locale from `kailo_theme` / `kailo_locale`, follows Kailo's `postMessage` changes (Kailo Web origin only) and exposes callbacks for the component's own theme and i18n. |
| `kailo-embed.d.ts` | Types of `window.KailoEmbed` for TypeScript components. |

## Single source

`kailo-theme-tokens.css` is rendered by
`client-kit/ts/platform/src/theme/embed-tokens.ts` from the same sources the
Kailo shell paints with: `theme.css`, `typography.css`, `tailwind.config.js`
and the default `buzz` / `buzz-dark` palettes (Shiki `github-light` /
`github-dark` through `adaptive-theme.ts` and the neutral accent). The dark
`--kailo-hsl-background` is the Buzz Dark content canvas the component frame
sits on. Never edit the CSS by hand; regenerate in the check image:

```bash
KAILO_WRITE_EMBED_TOKENS=1 pnpm --filter @client-kit/platform exec vitest run test/embed-tokens.test.ts
```

Without the variable the same test fails whenever the committed file differs
from the sources, so a shell theme change cannot silently leave components
behind.

## Token names

- `--kailo-color-<name>`: complete colors, e.g. `var(--kailo-color-primary)`.
- `--kailo-hsl-<name>`: bare `H S% L%` triplets for alpha, e.g.
  `hsl(var(--kailo-hsl-border) / 0.5)`.
- Names: `background foreground card card-foreground popover popover-foreground
  primary primary-foreground secondary secondary-foreground muted muted-foreground
  accent accent-foreground destructive destructive-foreground border input ring
  sidebar-* chart-1..5`, plus direct colors `status-added status-deleted
  status-modified warning warning-background`.
- `--kailo-font-sans`, `--kailo-font-size-{xs,sm,base,lg,xl,2xl..6xl}`,
  `--kailo-radius`, `--kailo-radius-{lg,md,sm}`, `--kailo-shadow-{sm,md,lg}`.

The font stack starts with `"Inter Variable"`; load it from the component's
own build (`@fontsource-variable/inter`, the package web-client uses), never
from Kailo at run time.

## Using it in a component build

1. **Build input (source_digest).** In the component's `*/fork/upstream.yaml`
   artifact that serves the page, list the files in `inputs` and build from
   the repository root so the staged context contains them:

   ```yaml
   - name: knowledge-native-ui
     build_context: .
     build_dockerfile: knowledge/frontend/Dockerfile
     inputs: [knowledge/frontend/, client-kit/embed/kailo-theme-tokens.css, client-kit/embed/kailo-embed.js, web-client/web/public/app-icon.png]
   ```

   `tools/build-upstream.sh` stages exactly the `inputs` at their
   repository-relative paths, and `source_digest` hashes the same bytes. A
   token or runtime change therefore invalidates the recorded digest and
   `check.sh seam` fails until the component artifact is rebuilt; nothing is
   fetched at build or run time from another location.

2. **Copy into the artifact** (Dockerfile, paths relative to the repository
   root context), served from the component's own origin:

   ```dockerfile
   COPY client-kit/embed/kailo-theme-tokens.css client-kit/embed/kailo-embed.js /srv/www/kailo/
   COPY web-client/web/public/app-icon.png /srv/www/kailo/app-icon.png
   ```

3. **Page head**, before the component's own styles and scripts:

   ```html
   <meta name="kailo-web-origin" content="http://192.168.0.193:58090">
   <link rel="icon" type="image/png" href="/kailo/app-icon.png">
   <link rel="stylesheet" href="/kailo/kailo-theme-tokens.css">
   <script src="/kailo/kailo-embed.js"></script>
   ```

   `kailo-web-origin` is a deployment fact: render it from the component
   unit's existing `KAILO_FRAME_ANCESTORS` (space-separated exact origins, the
   same value its `frame-ancestors` uses). It is never read from the URL or
   the referrer.

4. **Overlay.** Map the component's own theme variables to the tokens once
   (e.g. `--td-brand-color: var(--kailo-color-primary)` for TDesign, an MUI or
   antd theme object built from `getComputedStyle`), instead of page-by-page
   colors. `<html data-kailo-embedded>` is present inside the Kailo frame for
   hiding the component's duplicate global chrome.

5. **Runtime hooks.**

   ```js
   const embed = window.KailoEmbed;
   applyTheme(embed.getState().theme);          // "light" | "dark"
   i18n.setLocale(embed.getState().locale);      // "zh-CN" | "en"
   embed.onThemeChange(applyTheme);
   embed.onLocaleChange((locale) => i18n.setLocale(locale));
   // Top-level visit only: seed the language from the OIDC `locale` claim.
   embed.useIdentityLocale(idTokenClaims.locale);
   // prompt=none returned login_required inside the frame:
   if (!embed.requestTopLevelSignIn()) showOwnExpiredNotice();
   ```

   `requestTopLevelSignIn()` returns `true` once `auth-required` was posted to
   the Kailo origin. From then on Kailo alone prompts for the new sign-in
   (V-SCN-226): the page shows no "sign in again" notice, dialog or toast of
   its own (for the request that failed or the ones that follow) and leaves the
   frame neutral until Kailo reloads it after the sign-in. Only when it returns
   `false` (top level, or no Kailo origin configured) does the page explain the
   expired session itself.

   The runtime also emits `window` event `kailo:presentation`
   (`detail: {state, changed}`) for frameworks that prefer DOM events.

6. **Preferences (DD-138).** Personal preferences live in Kailo settings,
   never in the component page. Declare each one in the release manifest's
   `frontendPresentationContract.preferences` (key, Kailo settings category,
   `BOOLEAN`/`ENUM`, options, default, `ZH_CN`/`EN` labels; design 07 §4.8.2)
   and read the values Kailo sends:

   ```js
   const values = embed.getPreferences();        // {"documents.spellcheck": false, ...}
   embed.onPreferencesChange((values, changedKeys) => applyPreferences(values));
   ```

   A key that has not arrived uses the declared default; unknown keys are
   ignored. The runtime also emits `kailo:preferences`
   (`detail: {values, changed}`).

## Wire protocol v1

| Direction | Message |
|---|---|
| component → Kailo | `{source: "kailo-embed", version: 1, type: "ready"}` on load |
| component → Kailo | `{source: "kailo-embed", version: 1, type: "auth-required"}` |
| Kailo → component | `{source: "kailo-host", version: 1, type: "presentation", theme, locale}` on `ready` and on every change |
| Kailo → component | `{source: "kailo-host", version: 1, type: "preferences", values}` on `ready` (after `presentation`) and on every change of a declared preference (DD-138) |

DD-157 page shell (07 §4.8.7, `.design/20` §13), same version 1 — opt in per build with
`<meta name="kailo-embed-features" content="page toast confirm shortcuts">` before the runtime:

| Direction | Message |
|---|---|
| component → Kailo | `ready` carries `features: [...]` (the declared subset) |
| component → Kailo | `{type: "page", page: {title, breadcrumbs, tabs, activeTab, actions}}` — `KailoEmbed.setPage()`; Kailo draws the header, the page draws none |
| component → Kailo | `{type: "toast", toast: {tone, title, description}}` — `KailoEmbed.toast()` |
| component → Kailo | `{type: "confirm", confirm: {id, tone, title, description, confirmLabel, cancelLabel, option?}}` — `KailoEmbed.confirm()`; `option: {label, warning?}` is one unchecked choice in the dialog, sent only to a host announcing `confirm-option` |
| component → Kailo | `{type: "shortcut", shortcut: "search"\|"settings"\|"back"\|"forward"}` — sent by the runtime itself |
| Kailo → component | `{type: "navigate", target: {kind: "tab"\|"breadcrumb", id}}`, `{type: "action", id}` — `onNavigate`, `onAction` |
| Kailo → component | `{type: "confirm-result", id, confirmed, option?}` — `option` only for a request that carried one, never true on a cancel |
| Kailo → component | `presentation` carries `features: [...]` the host handles; `KailoEmbed.hostSupports(name)` and `<html data-kailo-host-features>` reflect it. `setPage` returns `false` once an older host answered without `page` — keep your own header then |

Page, toast and confirm text is display text for the user's own browser: Kailo
renders it as plain text and never stores, logs or forwards it. The token sheet
also carries a base layer (canvas, scrollbars, selection, focus ring, theme-switch
without transitions) for `<html data-kailo-runtime>`.

Both sides post to one exact origin (never `"*"`), check `event.origin` against
the configured origin and `event.source` against the expected window, and
ignore any other shape or version.
