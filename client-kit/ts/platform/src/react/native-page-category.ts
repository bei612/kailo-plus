// DD-138(4)(5), 07 §4.8.3/§4.8.4: the sidebar label (云盘/知识库/问数, the same keys as
// nativeEntryTitle) for a presentation category, used as the source of an Inbox item or a
// search group. Never a component name, type key or binding.
import type { NativePageCategory } from "@client-kit/contracts";
import type { PlatformMessageKey } from "../i18n";

export function nativePageCategoryTitle(category: NativePageCategory | string | undefined,
  t: (key: PlatformMessageKey) => string): string | null {
  const value = category === undefined ? undefined : String(category);
  return value === "file_storage" ? t("bindings.native.files") : value === "knowledge" ? t("bindings.native.knowledge")
    : value === "data_query" ? t("bindings.native.data") : null;
}
