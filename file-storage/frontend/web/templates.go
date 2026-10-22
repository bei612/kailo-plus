/*
 * Copyright (c) 2023. Abstrium SAS <team (at) pydio.com>
 * This file is part of Pydio Cells.
 *
 * Pydio Cells is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Pydio Cells is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Pydio Cells.  If not, see <http://www.gnu.org/licenses/>.
 *
 * The latest code can be found at <https://pydio.com>.
 */

package web

import (
	"context"
	"html/template"

	"github.com/pydio/cells/v5/common/utils/i18n/languages"
)

// TplConfFilterFunc takes a TplConf and modifies it
type TplConfFilterFunc func(ctx context.Context, in *TplConf, publicLinkId string) *TplConf

var (
	tplConfFilters []TplConfFilterFunc
)

// RegisterTplConfFilter registers a filter for modifying main Template Conf
func RegisterTplConfFilter(f TplConfFilterFunc) {
	tplConfFilters = append(tplConfFilters, f)
}

// FilterTplConf applies registered filters on TplConf object
func FilterTplConf(ctx context.Context, i *TplConf, publicLinkId string) *TplConf {
	for _, f := range tplConfFilters {
		i = f(ctx, i, publicLinkId)
	}
	return i
}

// TplConf is a data struct for main index page template
type TplConf struct {
	ApplicationTitle string
	Favicon          string
	Rebase           string
	ResourcesFolder  string
	Theme            string
	Version          string
	ErrorMessage     string
	LoadingString    string
	CustomHTMLHeader template.HTML
	// KailoHead links the Kailo tokens, overlay and embedding bridge (DD-133).
	KailoHead       template.HTML
	StartParameters map[string]interface{}
}

// GetLoadingString sends an i18n string for "Loading..."
func GetLoadingString(lang string) string {
	if s, o := languages.LoadingStrings[lang]; o {
		return s
	} else {
		return languages.LoadingStrings["en-us"]
	}
}

var Loader = `
<div class="kailo-loader" style="position: absolute;display:flex; flex-direction:column ;top: 0;bottom: 0;left: 0;right: 0;align-items: center;justify-content: center; font-family: var(--kailo-font-sans);background-color:var(--kailo-color-background); color: var(--kailo-color-muted-foreground)">
	<img src="` + KailoFavicon + `" alt="" width="56" height="56" style="border-radius: 12px">
	<div style="font-size:12px; margin-top: 10px;">{{.LoadingString}}</div>
</div>`

var loading = `<!DOCTYPE html>
<html xmlns:ajxp>
	<head>
		<title>{{.ApplicationTitle}}</title>
{{if .CustomHTMLHeader}}{{.CustomHTMLHeader}}{{end}}
{{if .KailoHead}}{{.KailoHead}}{{end}}
		{{if .Rebase}}<base href="{{.Rebase}}"/>{{end}}
		<link rel="stylesheet" type="text/css" href="{{.ResourcesFolder}}/dist/pydio.{{.Theme}}.min.css?v={{.Version}}">
		<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0">
	</head>
	<body style="position: absolute;display:flex;top: 0;bottom: 0;left: 0;right: 0;align-items: center;justify-content: center; background-color:var(--kailo-color-background);" class="react-mui-context">
		<script type="text/javascript">
			window.setTimeout(function(){window.location.reload();}, 4000);
		</script>
		<div style="color: var(--kailo-color-foreground)">{{.ApplicationTitle}} …</div>
	</body>
</html>
`

var Page = `<!DOCTYPE html>
<html xmlns:ajxp>
	<head>
		<title>{{.ApplicationTitle}}</title>
{{if .CustomHTMLHeader}}{{.CustomHTMLHeader}}{{end}}
{{if .KailoHead}}{{.KailoHead}}{{end}}
		{{if .Rebase}}<base href="{{.Rebase}}"/>{{end}}
		<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0">
		<script language="javascript" type="text/javascript" src="{{.ResourcesFolder}}/dist/boot/pydio.boot.min.js?v={{.Version}}"></script>
		<link rel="icon" type="image/png" href="{{.Favicon}}">
	</head>
	<body style="overflow: hidden;background-color: var(--kailo-color-background);" class="react-mui-context">
		<script type="text/javascript">
			var pydio, startParameters = {}, MessageHash={};
			startParameters = {{.StartParameters}};
			window.pydioBootstrap = new PydioBootstrap(startParameters);
		</script>
		<div id="{{.StartParameters.MAIN_ELEMENT}}">` + Loader + `</div>
	</body>
</html>
`

var Public = `<!DOCTYPE html>
<html xmlns:ajxp>
	<head>
		<title>{{.ApplicationTitle}}</title>
{{if .CustomHTMLHeader}}{{.CustomHTMLHeader}}{{end}}
{{if .KailoHead}}{{.KailoHead}}{{end}}
		{{if .Rebase}}<base href="{{.Rebase}}"/>{{end}}
		<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0">
		<script language="javascript" type="text/javascript" src="{{.ResourcesFolder}}/dist/boot/pydio.boot.min.js?v={{.Version}}"></script>
		<link rel="icon" type="image/png" href="{{.Favicon}}">
	</head>
	<body style="overflow: hidden;background-color: var(--kailo-color-background);" class="react-mui-context">
		<script type="text/javascript">
			var pydio, startParameters = {}, MessageHash={};
			startParameters = {{.StartParameters}};
			window.pydioBootstrap = new PydioBootstrap(startParameters);
		</script>
		<div class="vertical_fit vertical_layout" id="{{.StartParameters.MAIN_ELEMENT}}">` + Loader + `</div>
	</body>
</html>
`

var errorTpl = `<!DOCTYPE html>
<html xmlns:ajxp>
	<head>
		<title>{{.ApplicationTitle}}</title>
{{if .CustomHTMLHeader}}{{.CustomHTMLHeader}}{{end}}
{{if .KailoHead}}{{.KailoHead}}{{end}}
		{{if .Rebase}}<base href="{{.Rebase}}"/>{{end}}
		<link rel="stylesheet" type="text/css" href="{{.ResourcesFolder}}/dist/pydio.{{.Theme}}.min.css?v={{.Version}}">
		<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0">
		<link rel="icon" type="image/png" href="{{.Favicon}}">
	</head>
	<body style="position: absolute;display:flex;top: 0;bottom: 0;left: 0;right: 0;align-items: center;justify-content: center;" class="react-mui-context">
		<div>{{.ErrorMessage}}</div>
	</body>
</html>
`
