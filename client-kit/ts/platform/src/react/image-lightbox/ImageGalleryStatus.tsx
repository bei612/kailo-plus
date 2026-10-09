// Shared from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/shared/ui/markdown/ImageGalleryStatus.tsx.
import { useUiT } from "../context";

type ImageGalleryStatusProps = {
	currentIndex: number;
	itemCount: number;
};

export function ImageGalleryStatus({
	currentIndex,
	itemCount,
}: ImageGalleryStatusProps) {
	const t = useUiT();
	if (itemCount <= 1) {
		return null;
	}

	const position = currentIndex + 1;
	return (
		<>
			<div
				aria-hidden="true"
				className="h-5 w-px shrink-0 bg-muted-foreground/15"
			/>
			<span
				aria-label={t("buzz.imageGalleryStatus", { position, itemCount })}
				aria-live="polite"
				className="min-w-9 text-center text-xs font-medium tabular-nums text-muted-foreground"
				role="status"
			>
				{position} / {itemCount}
			</span>
		</>
	);
}
