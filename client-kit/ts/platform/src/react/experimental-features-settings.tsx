// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/settings/ui/ExperimentalFeaturesCard.tsx.
import { useUiLocale } from "./context";
import { translate } from "../i18n";
import { desktopFeatures, useFeatureToggle } from "./features";
import { featureText } from "./features/featureText";
import type { FeatureDefinition } from "./features/types";
import { Switch } from "./switch";
import {
	SettingsOptionGroup,
	SettingsOptionRow,
} from "./settings-option-group";
import { SettingsSectionHeader } from "./settings-surface";

function FeatureRow({ feature }: { feature: FeatureDefinition }) {
	const [enabled, toggle] = useFeatureToggle(feature.id);
	const text = featureText(useUiLocale(), feature);
	const switchId = `feature-toggle-${feature.id}`;
	return (
		<SettingsOptionRow>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium" id={`${switchId}-label`}>
					{text.name}
				</p>
				<p className="text-xs text-muted-foreground/70" data-settings-subcopy>
					{text.description}
				</p>
			</div>
			<Switch
				aria-labelledby={`${switchId}-label`}
				checked={enabled}
				data-testid={switchId}
				onCheckedChange={toggle}
			/>
		</SettingsOptionRow>
	);
}

export function ExperimentalFeaturesCard() {
	const locale = useUiLocale();
	return (
		<section className="min-w-0" data-testid="settings-experimental">
			<SettingsSectionHeader
				title={translate(locale, "platform.settings.experimental")}
				description={translate(locale, "preview.description")}
			/>
			<SettingsOptionGroup title={translate(locale, "preview.features")}>
				{desktopFeatures.map((feature) => (
					<FeatureRow key={feature.id} feature={feature} />
				))}
			</SettingsOptionGroup>
		</section>
	);
}
