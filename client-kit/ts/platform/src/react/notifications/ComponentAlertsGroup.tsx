// DD-138(4), 07 §4.8.3 提醒: the six component notification categories as Kailo-owned rows
// in 设置「通知」. Labels name the category only, never a component or presentation category.
import type { ComponentNotificationCategory } from "@client-kit/contracts";
import { translate } from "../../i18n";
import { useUiLocale } from "../context";
import { Switch } from "../switch";
import { SettingsOptionGroup, SettingsOptionRow } from "../settings-option-group";
import { COMPONENT_NOTIFICATION_CATEGORIES, componentAlertLabelKeys, type ComponentAlertsEnabled } from "./component-alerts";

export function ComponentAlertsGroup({ enabled, onChange }: {
  enabled: ComponentAlertsEnabled;
  onChange: (category: ComponentNotificationCategory, enabled: boolean) => void;
}) {
  const locale = useUiLocale();
  return (
    <SettingsOptionGroup title={translate(locale, "platform.notifications.componentGroup")}>
      {COMPONENT_NOTIFICATION_CATEGORIES.map((category) => {
        const [label, description] = componentAlertLabelKeys[category];
        const id = `component-alerts-${category.toLowerCase()}-switch`;
        return (
          <SettingsOptionRow key={category}>
            <div className="min-w-0">
              <label className="text-sm font-medium" htmlFor={id}>{translate(locale, label)}</label>
              <p className="text-sm font-normal text-muted-foreground/70" data-settings-subcopy>
                {translate(locale, description)}
              </p>
            </div>
            <Switch
              checked={enabled[category]}
              data-testid={`notifications-component-${category}`}
              id={id}
              onCheckedChange={(checked) => onChange(category, checked)}
            />
          </SettingsOptionRow>
        );
      })}
    </SettingsOptionGroup>
  );
}
