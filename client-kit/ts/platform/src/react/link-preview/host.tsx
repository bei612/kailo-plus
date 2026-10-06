import { createContext, useContext } from "react";
export const LinkPreviewHost = createContext<{ onOpenSettings?: (section: "appearance") => void }>({});
export const useLinkPreviewHost = () => useContext(LinkPreviewHost);
