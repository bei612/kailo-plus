import { DraftDetailSurface } from "@client-kit/platform/react/draft-surfaces";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { getDraftPreview, openDraftEntry, sendDraftEntry, toDraftSurfaceItem, type DraftViewItem } from "./DraftsPanel";
import { Markdown } from "@/shared/ui/markdown";

export function DraftDetailPane({ item, onBack, onDelete }: {
  item: DraftViewItem | null; onBack?: () => void; onDelete: (draftKey: string) => void;
}) {
  const { goChannel } = useAppNavigation();
  return <DraftDetailSurface item={item ? toDraftSurfaceItem(item) : null} onBack={onBack} onDelete={onDelete}
    onOpen={(entry) => { void openDraftEntry(entry, goChannel); }}
    onSend={(entry) => { void sendDraftEntry(entry, goChannel); }}
    renderPreview={(draft, className) => <Markdown className={className} content={getDraftPreview(draft)} interactive={false} />} />;
}
