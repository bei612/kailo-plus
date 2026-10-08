// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/features/useFeatureEnabled.ts.
import { useSyncExternalStore, useCallback, useEffect } from "react";
import { translate } from "../../i18n";
import { useUiLocale } from "../context";
import { featureText } from "./featureText";
import { getFeature } from "./manifest";
import { resolveEnabled } from "./resolveEnabled";
import { getOverrides, setOverride, OVERRIDES_KEY } from "./store";

type Listener = () => void;
const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
	listeners.add(listener);
	const handleStorage = (event: StorageEvent) => {
		if (event.key === OVERRIDES_KEY) emitChange();
	};
	window.addEventListener("storage", handleStorage);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", handleStorage);
	};
}

export function emitChange(): void {
	cachedRaw = null;
	cachedParsed = null;
	for (const listener of listeners) listener();
}

let cachedRaw: string | null = null;
let cachedParsed: Record<string, boolean> | null = null;
const emptyOverrides: Record<string, boolean> = Object.freeze({});

function getSnapshot(): string {
	const overrides = getOverrides();
	const raw = JSON.stringify(overrides);
	if (raw !== cachedRaw) {
		cachedRaw = raw;
		cachedParsed = overrides;
	}
	return raw;
}

const getServerSnapshot = (): string => "{}";
function getParsedSnapshot(): Record<string, boolean> {
	getSnapshot();
	return cachedParsed ?? emptyOverrides;
}

export function useFeatureSnapshot(): Record<string, boolean> {
	useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
	return getParsedSnapshot();
}

// Original preview defaults are off; stable (unlisted) features remain visible.
// This hook only affects presentation, never server authorization or execution.
export function useFeatureEnabled(featureId: string): boolean {
	const overrides = useFeatureSnapshot();
	const feature = getFeature(featureId);
	return feature
		? resolveEnabled(featureId, overrides, feature.defaultEnabled)
		: true;
}

export function useFeatureToggle(
	featureId: string,
): [boolean, (enabled: boolean) => void] {
	const enabled = useFeatureEnabled(featureId);
	const toggle = useCallback(
		(value: boolean) => {
			setOverride(featureId, value);
			emitChange();
		},
		[featureId],
	);
	return [enabled, toggle];
}

export function usePreviewFeatureWarning(featureId: string): void {
	const enabled = useFeatureEnabled(featureId);
	const feature = getFeature(featureId);
	const locale = useUiLocale();
	useEffect(() => {
		if (!feature || enabled) return;
		let cancelled = false;
		void import("sonner").then(({ toast }) => {
			if (cancelled) return;
			toast.warning(
				translate(locale, "preview.warning", {
					feature: featureText(locale, feature).name,
				}),
			);
		});
		return () => {
			cancelled = true;
		};
	}, [feature, enabled, locale]);
}
