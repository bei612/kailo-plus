package templates

import (
	"context"
	"fmt"
	"os"
	"strings"
	"unicode"

	"github.com/pydio/cells/v5/common/config"
)

// Kailo brand of native mails (DD-133 §1): the product is the Kailo
// deployment display name plus the component name, the logo is the Kailo
// application icon of this artifact, and no upstream "powered by" line,
// sender name or button color remains. Applied through the native filter hook.
const (
	kailoMailLogo = "plug/kailo.embed/brand/app-icon.png"
	// client-kit --primary (light: 266 85.05% 58.04%) as a mail-safe hex value.
	kailoMailButtonColor = "#8839ef"
)

func init() {
	RegisterTemplateFilter(kailoMailBrand)
}

func kailoMailTitle(ctx context.Context) string {
	name := strings.TrimSpace(os.Getenv("PLATFORM_DISPLAY_NAME"))
	if name != "" && len(name) <= 64 && strings.IndexFunc(name, func(r rune) bool { return !unicode.IsPrint(r) }) < 0 {
		return name + " 云盘"
	}
	// The native application title, set declaratively by the deployment.
	if title := config.Get(ctx, config.FrontendPluginPath(config.KeyFrontPluginCorePydio, config.KeyFrontApplicationTitle)...).String(); title != "" {
		return title
	}
	return "云盘"
}

func kailoMailBrand(ctx context.Context, a ApplicationConfigs) ApplicationConfigs {
	title := kailoMailTitle(ctx)
	a.Title = title
	if a.FromName == "" || a.FromName == "Pydio" {
		a.FromName = title
	}
	a.Logo = fmt.Sprintf("%s/%s", strings.TrimRight(a.Url, "/"), kailoMailLogo)
	a.Copyright = title
	a.ButtonsColor = kailoMailButtonColor
	return a
}
