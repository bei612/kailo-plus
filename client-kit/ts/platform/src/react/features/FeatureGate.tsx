// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/features/FeatureGate.tsx.
import type { ReactNode } from "react";
import { useFeatureEnabled } from "./useFeatureEnabled";

interface FeatureGateProps {
	feature: string;
	children: ReactNode;
	fallback?: ReactNode;
}

export function FeatureGate({
	feature,
	children,
	fallback = null,
}: FeatureGateProps): ReactNode {
	return useFeatureEnabled(feature) ? children : fallback;
}
