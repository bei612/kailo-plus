import {
	translate,
	type PlatformLocale,
	type PlatformMessageKey,
} from "../../i18n";
import type { FeatureDefinition } from "./types";

const featureKeys: Record<
	string,
	readonly [PlatformMessageKey, PlatformMessageKey]
> = {
	workflows: ["preview.workflows.name", "preview.workflows.description"],
	projects: ["preview.projects.name", "preview.projects.description"],
	pulse: ["preview.pulse.name", "preview.pulse.description"],
	forum: ["preview.forum.name", "preview.forum.description"],
};

export function featureText(
	locale: PlatformLocale,
	feature: FeatureDefinition,
) {
	const keys = featureKeys[feature.id];
	return keys
		? {
				name: translate(locale, keys[0]),
				description: translate(locale, keys[1]),
			}
		: { name: feature.name, description: feature.description };
}
