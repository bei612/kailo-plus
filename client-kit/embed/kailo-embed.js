/*!
 * kailo-embed.js — Kailo presentation runtime for component pages (DD-133).
 * Plain script, no dependencies, no network access. Load it synchronously in
 * <head> (after kailo-theme-tokens.css) so the first paint already has the
 * Kailo theme:
 *
 *   <meta name="kailo-web-origin" content="https://kailo.example.com">
 *   <link rel="stylesheet" href="/kailo/kailo-theme-tokens.css">
 *   <script src="/kailo/kailo-embed.js"></script>
 *
 * Wire protocol v1 (window.postMessage, never "*"):
 *   component -> Kailo  {source:"kailo-embed", version:1, type:"ready"}
 *   component -> Kailo  {source:"kailo-embed", version:1, type:"auth-required"}
 *   Kailo -> component  {source:"kailo-host", version:1, type:"presentation",
 *                        theme:"light"|"dark", locale:"zh-CN"|"en",
 *                        fontSize?:"smaller"|"default"|"larger", zoom?:0.75..1.5}   (DD-167)
 *   Kailo -> component  {source:"kailo-host", version:1, type:"preferences",
 *                        values:{<key>: boolean | "<option>"}}   (DD-138)
 *
 * Preferences are the values of the items the component's release declares
 * for Kailo settings (design 07 §4.8.2). Kailo sends every declared key; the
 * component uses its own declared default for a key it has not received.
 *
 * DD-157 page shell (design 07 §4.8.7), same version 1; a host that predates it
 * ignores the unknown types. Opt in per build with
 *   <meta name="kailo-embed-features" content="page toast confirm shortcuts">
 *   component -> Kailo  ready carries features:[...] (the declared subset)
 *   component -> Kailo  {type:"page", page:{title, breadcrumbs, tabs, activeTab, actions}}
 *   component -> Kailo  {type:"toast", toast:{tone, title, description?}}
 *   component -> Kailo  {type:"confirm", confirm:{id, tone, title, description?, confirmLabel?, cancelLabel?, option?}}
 *                       option:{label, warning?} one unchecked choice inside the dialog (e.g. "delete
 *                       permanently"); sent only to a host announcing "confirm-option"
 *   component -> Kailo  {type:"shortcut", shortcut:"search"|"settings"|"back"|"forward"}
 *   Kailo -> component  {type:"navigate", target:{kind:"tab"|"breadcrumb", id}}
 *   Kailo -> component  {type:"action", id, files?, paths?}   files: File[] the user chose in
 *                       Kailo's picker for an action declaring files:{accept, multiple, directory}
 *   Kailo -> component  {type:"confirm-result", id, confirmed, option?}   option: the choice, only
 *                       when the request carried one and confirmed is true
 *   Kailo -> component  presentation carries features:[...] the host draws/handles;
 *                       <html data-kailo-host-features> mirrors it once known
 * DD-167 type dials and prompt (design 07 §4.8.10), same version 1:
 *   launch parameters kailo_font_size=smaller|larger and kailo_zoom=<0.75..1.5> ride with kailo_theme
 *   only when not default; a Kailo launch without them means default. <html> carries
 *   data-kailo-font-size, --kailo-zoom and (zoom != 1) data-kailo-zoomed; getState() adds
 *   fontSize, zoom and typeScale (13/14, 1, 15/14); onTypeChange(listener) follows both dials.
 *   component -> Kailo  {type:"prompt", prompt:{id, title, label, description?, placeholder?, value?,
 *                       confirmLabel?, cancelLabel?, maxLength?}}   one line of text in Kailo's dialog
 *   Kailo -> component  {type:"prompt-result", id, confirmed, value?}   value only when confirmed
 * DD-138(6) admin surfaces (design 07 §4.8.5): Kailo loads one declared admin
 * function with the launch parameter kailo_admin_surface=<key>; KailoEmbed.adminSurface()
 * returns that key (kept for this path across OIDC redirects) or null. It only selects
 * which admin function to render; the component server still decides authority.
 *
 * Text in page/toast/confirm is display text for this user's own browser
 * only: Kailo renders it as plain text, never stores, logs or sends it on.
 */
(function (global) {
  "use strict";
  var doc = global.document;
  if (!doc || global.KailoEmbed) return;

  var VERSION = 1;
  var THEMES = ["light", "dark"];
  var LOCALES = ["zh-CN", "en"];
  // DD-167: Kailo's text-only size preference (13 / 14 / 15 px body) and ⌘± zoom.
  var FONT_SIZES = ["smaller", "default", "larger"];
  var TYPE_SCALES = { smaller: 13 / 14, "default": 1, larger: 15 / 14 };
  var ZOOM_MIN = 0.75;
  var ZOOM_MAX = 1.5;
  var STORE_KEY = "kailo-embed-presentation";
  var PREFERENCES_KEY = "kailo-embed-preferences";
  var ADMIN_SURFACE_KEY = "kailo-embed-admin-surface";
  var PREFERENCE_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,3}$/;
  var PREFERENCE_OPTION = /^[A-Za-z0-9._-]{1,32}$/;
  var MAX_PREFERENCES = 16;
  // DD-157 (07 §4.8.7): closed vocabularies and bounds, mirrored by the host.
  var FEATURES = ["page", "toast", "confirm", "shortcuts", "prompt"];
  // What a host may announce: the page features plus the file selection channel and the
  // confirmation choice (acceptance batch 5: Cells "delete permanently" stays in Kailo's dialog).
  var HOST_FEATURES = FEATURES.concat(["files", "confirm-option"]);
  var ACTION_ICONS = ["upload", "plus", "folder-plus", "share", "download", "rocket", "refresh", "settings",
    "message-square-plus", "play", "trash", "pencil", "filter", "search", "more"];
  var ACTION_VARIANTS = ["primary", "secondary", "menu"];
  var TOAST_TONES = ["success", "info", "warning", "error"];
  var CONFIRM_TONES = ["default", "danger"];
  var CONTROL = /[\u0000-\u001f\u007f]/;
  var ACCEPT = /^[A-Za-z0-9.+\-\/*, ]{1,200}$/;
  var MAX_FILES = 1000;
  var root = doc.documentElement;
  var framed = false;
  try { framed = global.parent !== global; } catch (e) { framed = true; }

  function member(value, allowed) {
    return typeof value === "string" && allowed.indexOf(value) >= 0 ? value : null;
  }

  // A zoom factor: a finite number (or numeric launch text) inside the bounds, else null.
  function zoomOf(value) {
    var number = typeof value === "string" && /^[0-9]+(\.[0-9]+)?$/.test(value) ? Number(value) : value;
    if (typeof number !== "number" || !isFinite(number)) return null;
    number = Math.round(number * 100) / 100;
    return number >= ZOOM_MIN && number <= ZOOM_MAX ? number : null;
  }

  function exactOrigin(text) {
    try {
      var url = new URL(text);
      return (url.protocol === "https:" || url.protocol === "http:") && url.origin === text ? text : null;
    } catch (e) { return null; }
  }

  function originsFrom(list) {
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      var origin = exactOrigin(list[i]);
      if (origin && out.indexOf(origin) < 0) out.push(origin);
    }
    return out;
  }

  // Deployment fact, rendered into the page by the component's own server or
  // build from the platform .env; never taken from the URL or the referrer.
  var meta = doc.querySelector('meta[name="kailo-web-origin"]');
  var origins = originsFrom(meta ? String(meta.getAttribute("content") || "").split(/\s+/) : []);

  function readStore() {
    try {
      var value = JSON.parse(global.sessionStorage.getItem(STORE_KEY) || "null");
      return value && typeof value === "object" ? value : {};
    } catch (e) { return {}; }
  }

  function writeStore(value) {
    try { global.sessionStorage.setItem(STORE_KEY, JSON.stringify(value)); } catch (e) { /* storage denied */ }
  }

  // DD-138: only booleans and option tokens under declared-key shapes; any
  // other shape rejects the whole message (no partial application).
  function validPreferences(values) {
    if (!values || typeof values !== "object" || Array.isArray(values)) return null;
    var keys = Object.keys(values);
    if (keys.length > MAX_PREFERENCES) return null;
    var out = {};
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      var value = values[key];
      if (key.length > 64 || !PREFERENCE_KEY.test(key)) return null;
      if (typeof value === "boolean" || (typeof value === "string" && PREFERENCE_OPTION.test(value))) out[key] = value;
      else return null;
    }
    return out;
  }

  function readPreferences() {
    try { return validPreferences(JSON.parse(global.sessionStorage.getItem(PREFERENCES_KEY) || "null")) || {}; } catch (e) { return {}; }
  }

  var params;
  try { params = new URLSearchParams(global.location.search); } catch (e) { params = null; }

  // DD-138(6): the admin surface Kailo launched this document for. Same key shape as a
  // preference key. sessionStorage is shared by every same-origin frame of the tab, so the
  // value is bound to the launched path: it survives an OIDC redirect back to that path, and a
  // fresh Kailo launch (kailo_theme present) without the parameter clears it.
  function readAdminSurface() {
    var path = global.location.pathname;
    var launched = params ? params.getAll("kailo_admin_surface") : [];
    if (launched.length) {
      // Exactly one well-formed key; a repeated parameter is as invalid as a malformed one.
      var valid = launched.length === 1 && launched[0].length <= 64 && PREFERENCE_KEY.test(launched[0]) ? launched[0] : null;
      try {
        if (valid) global.sessionStorage.setItem(ADMIN_SURFACE_KEY, JSON.stringify({ key: valid, path: path }));
        else global.sessionStorage.removeItem(ADMIN_SURFACE_KEY);
      } catch (e) { /* storage denied */ }
      return valid;
    }
    if (params && params.get("kailo_theme") !== null) {
      try { global.sessionStorage.removeItem(ADMIN_SURFACE_KEY); } catch (e) { /* storage denied */ }
      return null;
    }
    try {
      var stored = JSON.parse(global.sessionStorage.getItem(ADMIN_SURFACE_KEY) || "null");
      return stored && typeof stored.key === "string" && stored.path === path && stored.key.length <= 64
        && PREFERENCE_KEY.test(stored.key) ? stored.key : null;
    } catch (e) { return null; }
  }
  var adminSurface = readAdminSurface();
  if (adminSurface) root.setAttribute("data-kailo-admin-surface", adminSurface);
  var stored = readStore();
  var urlTheme = params ? member(params.get("kailo_theme"), THEMES) : null;
  var urlLocale = params ? member(params.get("kailo_locale"), LOCALES) : null;
  // DD-167: a Kailo launch (kailo_theme present) always states the dials; absent means default.
  var kailoLaunch = !!urlTheme;
  var urlFontSize = params ? member(params.get("kailo_font_size"), FONT_SIZES) : null;
  var urlZoom = params && params.get("kailo_zoom") !== null ? zoomOf(params.get("kailo_zoom")) : null;
  if (kailoLaunch) { urlFontSize = urlFontSize || "default"; urlZoom = urlZoom || 1; }
  var systemDark = false;
  try { systemDark = !!(global.matchMedia && global.matchMedia("(prefers-color-scheme: dark)").matches); } catch (e) { systemDark = false; }

  // Precedence: launch parameter, then the value this tab already received
  // (OIDC redirects drop the query string), then the device default.
  var state = {
    theme: urlTheme || member(stored.theme, THEMES) || (systemDark ? "dark" : "light"),
    locale: urlLocale || member(stored.locale, LOCALES) || "zh-CN",
    fontSize: urlFontSize || member(stored.fontSize, FONT_SIZES) || "default",
    zoom: urlZoom || zoomOf(stored.zoom) || 1
  };
  // What Kailo itself supplied (launch URL, earlier in this tab, or the host).
  // Only these values persist, so a device default or the identity locale
  // never masquerades as a Kailo value after the next redirect.
  var supplied = {
    theme: urlTheme || member(stored.theme, THEMES) || undefined,
    locale: urlLocale || member(stored.locale, LOCALES) || undefined,
    fontSize: urlFontSize || member(stored.fontSize, FONT_SIZES) || undefined,
    zoom: urlZoom || zoomOf(stored.zoom) || undefined
  };
  if (urlTheme || urlLocale || urlFontSize || urlZoom) writeStore(supplied);
  var hostConnected = false;
  var listeners = [];
  // Values Kailo supplied in this tab (kept across OIDC redirects like the presentation).
  var preferences = readPreferences();
  var preferenceListeners = [];

  // DD-157: what this build opted into (a build fact, like kailo-web-origin).
  var featureMeta = doc.querySelector('meta[name="kailo-embed-features"]');
  var features = [];
  (featureMeta ? String(featureMeta.getAttribute("content") || "").split(/\s+/) : []).forEach(function (name) {
    if (FEATURES.indexOf(name) >= 0 && features.indexOf(name) < 0) features.push(name);
  });
  function has(feature) { return features.indexOf(feature) >= 0; }

  function text(value, max, optional) {
    if (value === undefined || value === null || value === "") return optional ? undefined : null;
    if (typeof value !== "string" || CONTROL.test(value)) return null;
    var trimmed = value.replace(/\s+/g, " ").trim();
    if (!trimmed || trimmed.length > max) return null;
    return trimmed;
  }

  function opaqueId(value) {
    return typeof value === "string" && value.length >= 1 && value.length <= 256 && !CONTROL.test(value) ? value : null;
  }

  function items(list, max, label) {
    if (list === undefined) return [];
    if (!Array.isArray(list) || list.length > max) return null;
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      var item = list[i] || {};
      var id = opaqueId(item.id);
      var name = text(item.label, label);
      if (!id || !name) return null;
      out.push({ id: id, label: name });
    }
    return out;
  }

  // Shape of one page header; invalid input is rejected whole (never partially shown).
  function validPage(page) {
    if (!page || typeof page !== "object") return null;
    var title = text(page.title, 120);
    var breadcrumbs = items(page.breadcrumbs, 8, 80);
    var tabs = items(page.tabs, 8, 40);
    if (!title || !breadcrumbs || !tabs) return null;
    var activeTab = page.activeTab === undefined || page.activeTab === null ? undefined : opaqueId(page.activeTab);
    if (activeTab === null || (activeTab !== undefined && !tabs.some(function (tab) { return tab.id === activeTab; }))) return null;
    var actions = [];
    var primaries = 0;
    var list = page.actions === undefined ? [] : page.actions;
    if (!Array.isArray(list) || list.length > 8) return null;
    for (var i = 0; i < list.length; i += 1) {
      var action = list[i] || {};
      var id = opaqueId(action.id);
      var label = text(action.label, 40);
      var variant = member(action.variant || "secondary", ACTION_VARIANTS);
      var icon = action.icon === undefined ? undefined : member(action.icon, ACTION_ICONS);
      if (!id || !label || !variant || icon === null || actions.some(function (action) { return action.id === id; })) return null;
      if (variant === "primary") primaries += 1;
      var out = { id: id, label: label, variant: variant };
      if (icon) out.icon = icon;
      if (action.files !== undefined) {
        // DD-157: a file-choosing action; Kailo opens the picker inside the user's click.
        var files = action.files || {};
        if (typeof files !== "object" || (files.accept !== undefined && !(typeof files.accept === "string" && ACCEPT.test(files.accept)))) return null;
        out.files = {};
        if (files.accept) out.files.accept = files.accept;
        if (files.multiple === true) out.files.multiple = true;
        if (files.directory === true) out.files.directory = true;
      }
      if (action.disabled === true) out.disabled = true;
      if (action.busy === true) out.busy = true;
      actions.push(out);
    }
    if (primaries > 1) return null;
    var result = { title: title, breadcrumbs: breadcrumbs, tabs: tabs, actions: actions };
    if (activeTab) result.activeTab = activeTab;
    return result;
  }

  var currentPage = null;
  // What the Kailo host announced it handles; null until the first presentation.
  var hostFeatures = null;
  function hostHas(feature) { return hostConnected && hostFeatures !== null && hostFeatures.indexOf(feature) >= 0; }
  var navigateListeners = [];
  var actionListeners = [];
  var pendingConfirms = {};
  var confirmSequence = 0;
  var pendingPrompts = {};

  function apply() {
    root.setAttribute("data-kailo-runtime", "");
    if (state.theme === "dark") root.setAttribute("data-kailo-theme", "dark");
    else root.removeAttribute("data-kailo-theme");
    root.style.colorScheme = state.theme;
    root.setAttribute("lang", state.locale);
    root.setAttribute("data-kailo-font-size", state.fontSize);
    root.style.setProperty("--kailo-zoom", String(state.zoom));
    if (state.zoom !== 1) root.setAttribute("data-kailo-zoomed", "");
    else root.removeAttribute("data-kailo-zoomed");
    if (framed) root.setAttribute("data-kailo-embedded", "");
  }

  function snapshot() {
    var out = { theme: state.theme, locale: state.locale, fontSize: state.fontSize, zoom: state.zoom,
      typeScale: TYPE_SCALES[state.fontSize], embedded: framed, hostConnected: hostConnected };
    if (hostFeatures !== null) out.hostFeatures = hostFeatures.slice();
    return out;
  }

  function update(theme, locale, announce, fontSize, zoom) {
    fontSize = fontSize || state.fontSize;
    zoom = zoom || state.zoom;
    var changed = { theme: theme !== state.theme, locale: locale !== state.locale,
      fontSize: fontSize !== state.fontSize, zoom: zoom !== state.zoom };
    state.theme = theme;
    state.locale = locale;
    state.fontSize = fontSize;
    state.zoom = zoom;
    // DD-157: a theme flip lands in one frame, without each control animating to its new color.
    if (changed.theme) root.setAttribute("data-kailo-theme-switching", "");
    apply();
    if (changed.theme) {
      var settle = function () { root.removeAttribute("data-kailo-theme-switching"); };
      if (global.requestAnimationFrame) global.requestAnimationFrame(function () { global.requestAnimationFrame(settle); });
      else setTimeout(settle, 32);
    }
    // DD-157: the first answer from Kailo is always announced (it carries the host's features).
    if (!changed.theme && !changed.locale && !changed.fontSize && !changed.zoom && !announce) return;
    var current = snapshot();
    var targets = listeners.slice();
    for (var i = 0; i < targets.length; i += 1) {
      // One failing component callback must not starve the others.
      try { targets[i](current, changed); } catch (e) { setTimeout(function (error) { return function () { throw error; }; }(e), 0); }
    }
    try { global.dispatchEvent(new CustomEvent("kailo:presentation", { detail: { state: current, changed: changed } })); } catch (e) { /* old engines */ }
  }

  function post(type, payload) {
    if (!framed) return false;
    var message = { source: "kailo-embed", version: VERSION, type: type };
    for (var key in payload || {}) if (Object.prototype.hasOwnProperty.call(payload, key)) message[key] = payload[key];
    for (var i = 0; i < origins.length; i += 1) {
      // The browser delivers only to the origin that actually frames us.
      global.parent.postMessage(message, origins[i]);
    }
    return origins.length > 0;
  }

  function notify(list, value) {
    var targets = list.slice();
    for (var i = 0; i < targets.length; i += 1) {
      try { targets[i](value); } catch (e) { setTimeout(function (error) { return function () { throw error; }; }(e), 0); }
    }
  }

  function notifyAction(id, selection) {
    var targets = actionListeners.slice();
    for (var i = 0; i < targets.length; i += 1) {
      try { targets[i](id, selection); } catch (e) { setTimeout(function (error) { return function () { throw error; }; }(e), 0); }
    }
  }

  function listen(list, listener) {
    if (typeof listener !== "function") throw new TypeError("KailoEmbed listener must be a function");
    list.push(listener);
    return function unsubscribe() {
      var index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    };
  }

  // DD-157: Kailo's global chords pressed inside the frame go to Kailo (07 §4.8.7),
  // before any component handler sees them, so no second search or settings opens.
  function shortcutOf(event) {
    var mac = /mac|iphone|ipad|ipod/i.test(String(global.navigator && global.navigator.platform || ""));
    var primary = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    var key = String(event.key || "").toLowerCase();
    if (primary && !event.altKey && !event.shiftKey) {
      if (key === "k" || event.code === "KeyK") return "search";
      if (key === "," || event.code === "Comma") return "settings";
      if (mac && (key === "[" || event.code === "BracketLeft")) return "back";
      if (mac && (key === "]" || event.code === "BracketRight")) return "forward";
    }
    if (!mac && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (key === "arrowleft") return "back";
      if (key === "arrowright") return "forward";
    }
    return null;
  }

  function copy(values) {
    var out = {};
    for (var key in values) if (Object.prototype.hasOwnProperty.call(values, key)) out[key] = values[key];
    return out;
  }

  function updatePreferences(next) {
    var changed = [];
    var key;
    for (key in next) if (next[key] !== preferences[key]) changed.push(key);
    for (key in preferences) if (!Object.prototype.hasOwnProperty.call(next, key)) changed.push(key);
    preferences = next;
    try { global.sessionStorage.setItem(PREFERENCES_KEY, JSON.stringify(next)); } catch (e) { /* storage denied */ }
    if (!changed.length) return;
    var targets = preferenceListeners.slice();
    for (var i = 0; i < targets.length; i += 1) {
      try { targets[i](copy(next), changed.slice()); } catch (e) { setTimeout(function (error) { return function () { throw error; }; }(e), 0); }
    }
    try { global.dispatchEvent(new CustomEvent("kailo:preferences", { detail: { values: copy(next), changed: changed.slice() } })); } catch (e) { /* old engines */ }
  }

  global.addEventListener("message", function (event) {
    if (!framed || event.source !== global.parent || origins.indexOf(event.origin) < 0) return;
    var data = event.data;
    if (!data || typeof data !== "object" || data.source !== "kailo-host" || data.version !== VERSION) return;
    if (data.type === "preferences") {
      var values = validPreferences(data.values);
      if (values) updatePreferences(values);
      return;
    }
    if (data.type === "navigate") {
      var target = data.target || {};
      var kind = member(target.kind, ["tab", "breadcrumb"]);
      var targetId = opaqueId(target.id);
      // Only an id this page declared in its current header is a valid target.
      var declared = currentPage && (kind === "tab" ? currentPage.tabs : currentPage.breadcrumbs);
      if (kind && targetId && declared && declared.some(function (item) { return item.id === targetId; }))
        notify(navigateListeners, { kind: kind, id: targetId });
      return;
    }
    if (data.type === "action") {
      var actionId = opaqueId(data.id);
      var declaredAction = null;
      if (actionId && currentPage) currentPage.actions.forEach(function (action) { if (action.id === actionId && !action.disabled && !action.busy) declaredAction = action; });
      if (!declaredAction) return;
      if (!declaredAction.files) { if (data.files === undefined) notifyAction(actionId); return; }
      // A Kailo without the file channel delivers the bare action; the page uses its own picker flow.
      if (data.files === undefined && !hostHas("files")) { notifyAction(actionId); return; }
      // Files only for an action that declared them; every entry a File, paths parallel and bounded.
      var chosen = data.files;
      var paths = data.paths === undefined ? [] : data.paths;
      var FileType = global.File;
      if (!Array.isArray(chosen) || !chosen.length || chosen.length > MAX_FILES || !FileType) return;
      if (!declaredAction.files.multiple && !declaredAction.files.directory && chosen.length !== 1) return;
      if (!Array.isArray(paths) || (paths.length && paths.length !== chosen.length)) return;
      for (var f = 0; f < chosen.length; f += 1) {
        if (!(chosen[f] instanceof FileType)) return;
        if (paths.length && !(typeof paths[f] === "string" && paths[f].length <= 1024 && !CONTROL.test(paths[f]))) return;
      }
      notifyAction(actionId, { files: chosen.slice(), paths: paths.length ? paths.slice() : chosen.map(function (file) { return file.name; }) });
      return;
    }
    if (data.type === "confirm-result") {
      var pending = typeof data.id === "string" && Object.prototype.hasOwnProperty.call(pendingConfirms, data.id) ? pendingConfirms[data.id] : null;
      if (pending && typeof data.confirmed === "boolean") {
        delete pendingConfirms[data.id];
        // The choice only counts on a confirmation; a missing or malformed one is unchecked.
        if (pending.option) pending.resolve({ confirmed: data.confirmed, option: data.confirmed && data.option === true });
        else pending.resolve(data.confirmed);
      }
      return;
    }
    if (data.type === "prompt-result") {
      var asked = typeof data.id === "string" && Object.prototype.hasOwnProperty.call(pendingPrompts, data.id) ? pendingPrompts[data.id] : null;
      if (!asked || typeof data.confirmed !== "boolean") return;
      var answer = null;
      if (data.confirmed) {
        // Re-check the answer: trimmed, 1..maxLength, no control characters; anything else is a cancel.
        answer = typeof data.value === "string" ? data.value.trim() : "";
        if (!answer || answer.length > asked.maxLength || CONTROL.test(answer)) answer = null;
      }
      delete pendingPrompts[data.id];
      asked.resolve(answer);
      return;
    }
    if (data.type !== "presentation") return;
    var theme = member(data.theme, THEMES);
    var locale = member(data.locale, LOCALES);
    if (!theme || !locale) return;
    // DD-167: a host that predates the dials sends neither (= default); a malformed one drops the message.
    var fontSize = data.fontSize === undefined ? "default" : member(data.fontSize, FONT_SIZES);
    var zoom = data.zoom === undefined ? 1 : (typeof data.zoom === "number" ? zoomOf(data.zoom) : null);
    if (!fontSize || !zoom) return;
    var firstContact = !hostConnected;
    var announced = [];
    (Array.isArray(data.features) ? data.features : []).forEach(function (name) {
      if (HOST_FEATURES.indexOf(name) >= 0 && announced.indexOf(name) < 0) announced.push(name);
    });
    hostFeatures = announced;
    root.setAttribute("data-kailo-host-features", announced.join(" "));
    hostConnected = true;
    supplied = { theme: theme, locale: locale, fontSize: fontSize, zoom: zoom };
    writeStore(supplied);
    update(theme, locale, firstContact, fontSize, zoom);
    // A header set before Kailo answered is delivered once the host is known.
    if (firstContact && currentPage && hostHas("page")) post("page", { page: currentPage });
  });

  if (framed && has("shortcuts")) {
    global.addEventListener("keydown", function (event) {
      if (event.isComposing || event.repeat) return;
      var shortcut = shortcutOf(event);
      if (!shortcut || !origins.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      post("shortcut", { shortcut: shortcut });
    }, true);
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("KailoEmbed listener must be a function");
    listeners.push(listener);
    return function unsubscribe() {
      var index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    };
  }

  global.KailoEmbed = Object.freeze({
    version: VERSION,
    themes: THEMES.slice(),
    locales: LOCALES.slice(),
    /** {theme, locale, embedded, hostConnected} */
    getState: snapshot,
    /** listener(state, {theme: boolean, locale: boolean}); returns unsubscribe. */
    onChange: subscribe,
    onThemeChange: function (listener) {
      return subscribe(function (current, changed) { if (changed.theme) listener(current.theme); });
    },
    onLocaleChange: function (listener) {
      return subscribe(function (current, changed) { if (changed.locale) listener(current.locale); });
    },
    /** DD-167: listener({fontSize, zoom, typeScale}) when either type dial changes; returns unsubscribe. */
    onTypeChange: function (listener) {
      return subscribe(function (current, changed) {
        if (changed.fontSize || changed.zoom) listener({ fontSize: current.fontSize, zoom: current.zoom, typeScale: current.typeScale });
      });
    },
    /**
     * Top-level visits only: the OIDC `locale` claim may seed the language when
     * neither Kailo nor this tab supplied one. Ignored once Kailo has spoken.
     */
    useIdentityLocale: function (locale) {
      var value = member(locale, LOCALES);
      if (!value || supplied.locale) return false;
      update(state.theme, value);
      return true;
    },
    /**
     * Silent OIDC (prompt=none) failed inside the Kailo frame: ask Kailo to
     * re-authenticate at the top level. Never show a login form in the frame.
     */
    requestTopLevelSignIn: function () { return post("auth-required"); },
    /** DD-138(6): the declared admin surface key Kailo launched this page for, or null. */
    adminSurface: function () { return adminSurface; },
    /** DD-138: values of the component's declared Kailo settings items that Kailo supplied. */
    getPreferences: function () { return copy(preferences); },
    /** listener(values, changedKeys); returns unsubscribe. */
    onPreferencesChange: function (listener) {
      if (typeof listener !== "function") throw new TypeError("KailoEmbed listener must be a function");
      preferenceListeners.push(listener);
      return function unsubscribe() {
        var index = preferenceListeners.indexOf(listener);
        if (index >= 0) preferenceListeners.splice(index, 1);
      };
    },
    /** DD-157: the features this build declared in <meta name="kailo-embed-features">. */
    features: features.slice(),
    /**
     * DD-157: Kailo renders this page's header (title, breadcrumbs, tabs, actions); the
     * page renders no header of its own while `true` is returned. `null` clears it.
     * Invalid shapes throw, so a mistake shows in development instead of a blank header.
     */
    setPage: function (page) {
      if (!has("page")) return false;
      var valid = page === null ? null : validPage(page);
      if (page !== null && !valid) throw new TypeError("KailoEmbed.setPage: invalid page header");
      currentPage = valid;
      // Before Kailo answers the page is hidden behind Kailo's skeleton; once it has
      // answered, only a host that announced "page" draws the header.
      if (hostConnected && !hostHas("page")) return false;
      return post("page", { page: valid });
    },
    /** DD-157: whether the Kailo host announced it handles a feature (false until it answers). */
    hostSupports: function (feature) { return hostHas(feature); },
    /** listener({kind: "tab"|"breadcrumb", id}); only ids of the current header arrive. */
    onNavigate: function (listener) { return listen(navigateListeners, listener); },
    /**
     * listener(id, selection?) when the user activates one of the current header's actions in
     * Kailo; selection = {files: File[], paths: string[]} for an action declaring `files`.
     */
    onAction: function (listener) { return listen(actionListeners, listener); },
    /**
     * DD-157: Kailo shows the toast (one notification surface). Returns false when no
     * Kailo frame is present (top-level visit): the page then shows its own, styled per 20 §13.
     */
    toast: function (toast) {
      if (!has("toast") || !framed || !hostHas("toast") || !toast) return false;
      var tone = member(toast.tone || "info", TOAST_TONES);
      var title = text(toast.title, 120);
      var description = text(toast.description, 280, true);
      if (!tone || !title || description === null) return false;
      var payload = { tone: tone, title: title };
      if (description) payload.description = description;
      return post("toast", { toast: payload });
    },
    /**
     * DD-157: Kailo's confirmation dialog. Resolves true/false; returns null when no
     * Kailo frame is present, so the page uses its own dialog (styled per 20 §13).
     * With options.option {label, warning?} it resolves {confirmed, option} and returns null
     * unless the host announced "confirm-option" (an older Kailo cannot show the choice).
     */
    confirm: function (options) {
      if (!has("confirm") || !framed || !hostHas("confirm") || !options || typeof Promise !== "function") return null;
      var tone = member(options.tone || "default", CONFIRM_TONES);
      var title = text(options.title, 120);
      var description = text(options.description, 400, true);
      var confirmLabel = text(options.confirmLabel, 24, true);
      var cancelLabel = text(options.cancelLabel, 24, true);
      if (!tone || !title || description === null || confirmLabel === null || cancelLabel === null) return null;
      var option = null;
      if (options.option !== undefined) {
        if (!hostHas("confirm-option") || typeof options.option !== "object" || options.option === null) return null;
        var optionLabel = text(options.option.label, 80);
        var optionWarning = text(options.option.warning, 200, true);
        if (!optionLabel || optionWarning === null) return null;
        option = { label: optionLabel };
        if (optionWarning) option.warning = optionWarning;
      }
      confirmSequence += 1;
      var id = "c" + confirmSequence + "-" + Date.now().toString(36);
      var payload = { id: id, tone: tone, title: title };
      if (description) payload.description = description;
      if (confirmLabel) payload.confirmLabel = confirmLabel;
      if (cancelLabel) payload.cancelLabel = cancelLabel;
      if (option) payload.option = option;
      return new Promise(function (resolve) {
        pendingConfirms[id] = { resolve: resolve, option: option !== null };
        if (!post("confirm", { confirm: payload })) {
          delete pendingConfirms[id];
          resolve(option ? { confirmed: false, option: false } : false);
        }
      });
    },
    /**
     * DD-167: one line of text from the user in Kailo's dialog (e.g. a new folder's name), so the
     * overlay covers the whole window. Resolves the trimmed answer or null (cancelled); returns
     * null when the build did not declare "prompt" or Kailo did not announce it — the page then
     * shows its own dialog styled per 20 §9.
     */
    prompt: function (options) {
      if (!has("prompt") || !framed || !hostHas("prompt") || !options || typeof Promise !== "function") return null;
      var title = text(options.title, 120);
      var label = text(options.label, 80);
      var description = text(options.description, 400, true);
      var placeholder = text(options.placeholder, 80, true);
      var confirmLabel = text(options.confirmLabel, 24, true);
      var cancelLabel = text(options.cancelLabel, 24, true);
      var maxLength = options.maxLength === undefined ? 255 : options.maxLength;
      if (typeof maxLength !== "number" || maxLength % 1 !== 0 || maxLength < 1 || maxLength > 255) return null;
      var value = options.value === undefined || options.value === "" ? undefined : options.value;
      if (value !== undefined && (typeof value !== "string" || CONTROL.test(value) || value.length > maxLength)) return null;
      if (!title || !label || description === null || placeholder === null || confirmLabel === null || cancelLabel === null) return null;
      confirmSequence += 1;
      var id = "p" + confirmSequence + "-" + Date.now().toString(36);
      var payload = { id: id, title: title, label: label, maxLength: maxLength };
      if (description) payload.description = description;
      if (placeholder) payload.placeholder = placeholder;
      if (value !== undefined) payload.value = value;
      if (confirmLabel) payload.confirmLabel = confirmLabel;
      if (cancelLabel) payload.cancelLabel = cancelLabel;
      return new Promise(function (resolve) {
        pendingPrompts[id] = { resolve: resolve, maxLength: maxLength };
        if (!post("prompt", { prompt: payload })) {
          delete pendingPrompts[id];
          resolve(null);
        }
      });
    }
  });

  apply();
  post("ready", features.length ? { features: features.slice() } : undefined);
})(window);
