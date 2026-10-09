// Shared from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/shared/ui/markdown.tsx::ImageBlock.
import * as React from "react";
import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { useSmoothCorners } from "../profile/buzz/shared/ui/smoothCorners";
import { ImageZoomOverlay, type ImageActions } from "./ImageZoomOverlay";
import {
	MediaContextMenu,
	type MediaContextMenuPosition,
	useDismissMediaContextMenu,
} from "./MediaContextMenu";
import { ProgressiveImage } from "./ProgressiveImage";
import {
	imageReserveStyle,
	isInsideHiddenSpoiler,
	rememberDecodedImageDimensions,
	useFrozenImageReserve,
} from "./imageReserve";
import {
	type ImageGalleryItem,
	type ImageLightboxBox,
	type ImageLightboxCornerRadii,
	imageLightboxBoxFromRect,
	imageLightboxCornerRadiiFromElement,
	imageLightboxSourceScopeForTrigger,
	visibleImageGalleryForTrigger,
} from "./imageLightbox";
export type ImageBlockProps = ImageActions & {
	alt: string | undefined;
	dim?: string;
	onError?: () => void;
	resolvedSrc: string | undefined;
	src: string | undefined;
	thumbSrc?: string;
};

export function ImageBlock({
	alt,
	copyImageToClipboard,
	dim,
	downloadImage,
	onError,
	resolvedSrc,
	src,
	thumbSrc,
}: ImageBlockProps) {
	const t = useUiT();
	const [lightboxState, setLightboxState] = React.useState<{
		galleryIndex: number;
		galleryItems?: ImageGalleryItem[];
		sourceBox: ImageLightboxBox;
		sourceCornerRadii: ImageLightboxCornerRadii;
		sourceScope: Element | null;
	} | null>(null);
	const [isHiddenInSpoiler, setIsHiddenInSpoiler] = React.useState(false);
	const [menu, setMenu] = React.useState<MediaContextMenuPosition | null>(null);
	const inlineImageRef = React.useRef<HTMLImageElement | null>(null);
	const thumbnailImageRef = React.useRef<HTMLImageElement | null>(null);
	const triggerRef = React.useRef<HTMLButtonElement | null>(null);
	useSmoothCorners(inlineImageRef);
	useSmoothCorners(thumbnailImageRef);
	const [spoilerMediaSize, setSpoilerMediaSize] = React.useState<{
		height: number;
		src: string;
		width: number;
	} | null>(null);

	const updateSpoilerMediaSize = React.useCallback(
		(image: HTMLImageElement) => {
			const { naturalHeight, naturalWidth } = image;
			if (naturalHeight <= 0 || naturalWidth <= 0) return;

			const maxWidth = 384;
			const maxHeight = 256;
			const scale = Math.min(
				1,
				maxWidth / naturalWidth,
				maxHeight / naturalHeight,
			);
			setSpoilerMediaSize({
				height: Math.max(1, Math.round(naturalHeight * scale)),
				src: resolvedSrc ?? image.currentSrc,
				width: Math.max(1, Math.round(naturalWidth * scale)),
			});
		},
		[resolvedSrc],
	);

	const handleImageLoad = React.useCallback(
		(image: HTMLImageElement) => {
			rememberDecodedImageDimensions(
				resolvedSrc,
				image.naturalWidth,
				image.naturalHeight,
			);
			updateSpoilerMediaSize(image);
		},
		[resolvedSrc, updateSpoilerMediaSize],
	);

	const { intrinsicDimensions, useFixedReserveBox } = useFrozenImageReserve(
		dim,
		resolvedSrc,
	);

	const currentSpoilerMediaSize =
		spoilerMediaSize?.src === resolvedSrc ? spoilerMediaSize : null;
	const hiddenSpoilerMediaSize = isHiddenInSpoiler
		? currentSpoilerMediaSize
		: null;

	const spoilerMediaStyle = imageReserveStyle({
		hiddenSpoilerMediaSize,
		intrinsicDimensions,
		useFixedReserveBox,
	});

	React.useLayoutEffect(() => {
		const trigger = triggerRef.current;
		if (!trigger) return;

		const updateHiddenState = () => {
			setIsHiddenInSpoiler(isInsideHiddenSpoiler(trigger));
		};

		updateHiddenState();

		const spoiler = trigger.closest(".buzz-spoiler[data-spoiler]");
		if (!spoiler) return;

		const observer = new MutationObserver(updateHiddenState);
		observer.observe(spoiler, {
			attributeFilter: ["data-revealed"],
			attributes: true,
		});

		return () => observer.disconnect();
	}, []);
	const closeMenu = React.useCallback(() => setMenu(null), []);
	useDismissMediaContextMenu(Boolean(menu), closeMenu);

	const handleContextMenu = (e: React.MouseEvent) => {
		e.preventDefault();
		if (isInsideHiddenSpoiler(e.currentTarget)) return;
		e.stopPropagation();
		e.nativeEvent.stopImmediatePropagation();
		setMenu({ x: e.clientX, y: e.clientY });
	};
	const openLightbox = React.useCallback(
		(image: HTMLImageElement) => {
			if (!resolvedSrc || isInsideHiddenSpoiler(image)) {
				return;
			}

			const rect = image.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) {
				return;
			}

			setMenu(null);
			const sourceBox = imageLightboxBoxFromRect(rect);
			const sourceCornerRadii = imageLightboxCornerRadiiFromElement(image);
			const sourceScope = triggerRef.current
				? imageLightboxSourceScopeForTrigger(triggerRef.current)
				: null;
			const gallery = triggerRef.current
				? visibleImageGalleryForTrigger(
						triggerRef.current,
						{
							alt,
							dim,
							trigger: triggerRef.current,
							resolvedSrc,
							src,
							thumbnailBox: sourceBox,
							thumbnailCornerRadii: sourceCornerRadii,
						},
						sourceScope,
					)
				: { galleryIndex: 0, galleryItems: undefined };
			setLightboxState({
				galleryIndex: gallery.galleryIndex,
				galleryItems: gallery.galleryItems,
				sourceBox,
				sourceCornerRadii,
				sourceScope,
			});
		},
		[alt, dim, resolvedSrc, src],
	);

	const handleImageTriggerClick = () => {
		if (inlineImageRef.current) {
			openLightbox(inlineImageRef.current);
		}
	};

	const handleCopyImage = React.useCallback(
		(copySrc: string | undefined) => {
			setMenu(null);
			copyImageToClipboard(copySrc);
		},
		[copyImageToClipboard],
	);

	const handleDownload = React.useCallback(
		(downloadSrc: string | undefined) => {
			setMenu(null);
			downloadImage(downloadSrc);
		},
		[downloadImage],
	);

	return (
		<>
			<button
				aria-hidden={isHiddenInSpoiler ? true : undefined}
				aria-label={
					alt?.trim() ? t("buzz.zoomNamedImage", { alt }) : t("buzz.zoomImage")
				}
				className={cn(
					"mt-1 inline-block min-w-0 max-w-full cursor-zoom-in overflow-hidden rounded-2xl border-0 bg-transparent p-0 text-left align-top focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50",
					lightboxState && "opacity-0",
				)}
				data-image-lightbox-resolved-src={resolvedSrc}
				data-image-lightbox-alt={alt}
				data-image-lightbox-dim={dim}
				data-image-lightbox-src={src}
				data-image-lightbox-trigger=""
				data-testid="message-image-lightbox-trigger"
				ref={triggerRef}
				tabIndex={isHiddenInSpoiler ? -1 : undefined}
				type="button"
				onClick={handleImageTriggerClick}
				onContextMenuCapture={handleContextMenu}
			>
				<ProgressiveImage
					alt={alt}
					fullImageRef={inlineImageRef}
					height={intrinsicDimensions.height}
					onError={onError}
					onFullLoad={handleImageLoad}
					onThumbnailLoad={updateSpoilerMediaSize}
					resolvedSrc={resolvedSrc}
					showSpoilerSize={Boolean(hiddenSpoilerMediaSize)}
					style={spoilerMediaStyle}
					thumbnailRef={thumbnailImageRef}
					thumbSrc={thumbSrc}
					width={intrinsicDimensions.width}
				/>
			</button>
			{menu && src ? (
				<MediaContextMenu
					dataAttributes={["data-image-context-menu"]}
					items={[
						{
							label: t("buzz.copyImage"),
							onSelect: () => handleCopyImage(src),
						},
						{
							label: t("buzz.downloadImage"),
							onSelect: () => handleDownload(src),
						},
					]}
					position={menu}
				/>
			) : null}
			{lightboxState && resolvedSrc ? (
				<ImageZoomOverlay
					alt={alt}
					copyImageToClipboard={copyImageToClipboard}
					downloadImage={downloadImage}
					galleryIndex={lightboxState.galleryIndex}
					galleryItems={lightboxState.galleryItems}
					onClose={() => setLightboxState(null)}
					resolvedSrc={resolvedSrc}
					sourceBox={lightboxState.sourceBox}
					sourceCornerRadii={lightboxState.sourceCornerRadii}
					sourceScope={lightboxState.sourceScope}
					src={src}
				/>
			) : null}
		</>
	);
}
