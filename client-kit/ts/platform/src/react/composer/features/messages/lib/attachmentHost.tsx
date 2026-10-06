import { createContext, useContext, type ComponentType } from "react";
import type { BlobDescriptor } from "./imetaMediaMarkdown";

export type AttachmentHost = {
  resolveMediaUrl: (url: string) => string;
  fetchMediaBytes: (url: string) => Promise<Uint8Array<ArrayBuffer>>;
  AudioAttachment?: ComponentType<{ composer?: boolean; duration?: number; filename: string; href: string }>;
};
const AttachmentContext = createContext<AttachmentHost | null>(null);
export const AttachmentHostProvider = AttachmentContext.Provider;
export function useAttachmentHost(): AttachmentHost {
  const host = useContext(AttachmentContext);
  if (!host) throw new Error("Attachment media host is missing.");
  return host;
}
export type AttachmentEditingHost = {
  removeAttachment: (url: string) => void;
  revertAttachment: (url: string) => BlobDescriptor | null;
  uploadEditedAttachment: (url: string, bytes: Uint8Array) => Promise<BlobDescriptor | null>;
};
