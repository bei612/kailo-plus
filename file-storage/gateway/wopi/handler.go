/*
 * Copyright (c) 2018. Abstrium SAS <team (at) pydio.com>
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

package wopi

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"

	commonauth "github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/telemetry/log"
)

func auth(inner http.Handler) http.Handler {

	jwtVerifier := commonauth.DefaultJWTVerifier()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		ctx := r.Context()
		if tokens := r.URL.Query()["access_token"]; len(tokens) == 1 && tokens[0] != "" {
			ctx, claims, err := jwtVerifier.Verify(ctx, tokens[0])
			if err == nil && claims.Subject != "" && claims.Name != "" {
				// GenerateDocumentAccessToken binds one native PAT to one node and
				// an r/rw permission. Enforce that scope before any node/body access;
				// the original handlers still enforce the native node ACLs.
				nodeID := mux.Vars(r)["uuid"]
				if !claims.ProvidesScopes || len(claims.Scopes) != 1 || nodeID == "" {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				scope := strings.Split(claims.Scopes[0], ":")
				if len(scope) != 3 || scope[0] != "node" || scope[1] != nodeID ||
					(scope[2] != "r" && scope[2] != "rw") ||
					(r.Method != http.MethodGet && (r.Method != http.MethodPost || scope[2] != "rw")) {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				r = r.WithContext(ctx)
				r, err = platformSession(r, claims, nodeID)
				if err != nil {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				inner.ServeHTTP(w, r)
				return
			}

		}
		log.Logger(ctx).Error("JWT token validation failed, cannot process request")
		w.WriteHeader(http.StatusUnauthorized)
	})
}

func logger(inner http.Handler, name string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		start := time.Now()

		inner.ServeHTTP(w, r)

		log.Logger(r.Context()).Debug(
			fmt.Sprintf("%s %s %s %s",
				r.Method,
				r.URL.Path,
				name,
				time.Since(start),
			))
	})
}
