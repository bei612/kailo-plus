/*
 * Copyright (c) 2025. Abstrium SAS <team (at) pydio.com>
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

package migrations

import (
	"context"
	"sync"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/middleware"
	"github.com/pydio/cells/v5/common/registry"
	"github.com/pydio/cells/v5/common/runtime"
	"github.com/pydio/cells/v5/common/service"
	"github.com/pydio/cells/v5/common/utils/propagator"
)

var (
	migStatusesOK   = map[string]struct{}{}
	migStatusesLock = sync.RWMutex{}
)

func RegisterMigrationStatusModifier() {
	middleware.RegisterModifier(propagator.IncomingContextModifier(migrationStatusModifier))
}

func migrationStatusModifier(ctx context.Context) (out context.Context, update bool, err error) {
	out = ctx
	serviceName := runtime.GetServiceName(ctx)
	serviceVersionKey := runtime.GetServiceVersionKey(ctx)
	migStatusesLock.RLock()
	if _, ok := migStatusesOK[serviceVersionKey]; ok {
		migStatusesLock.RUnlock()
		return
	}
	migStatusesLock.RUnlock()
	var reg registry.Registry
	propagator.Get(ctx, registry.ContextKey, &reg)
	if reg == nil {
		return
	}
	items, err := reg.List(registry.WithName(serviceName))
	if err != nil || len(items) == 0 {
		//fmt.Println("Ignoring MigrationStatus Service " + serviceName + " not found")
		return
	}
	var svc service.Service
	if !items[0].As(&svc) {
		return
	}
	if len(svc.Options().Migrations) == 0 {
		return
	}

	svcVersion := config.Get(ctx, "versions", serviceVersionKey).String()
	crtVersion := common.Version().String()
	if svcVersion != crtVersion {
		//fmt.Println("RETURNING UNAVAILABLE FOR SERVICE ", serviceName, "GLOBAL IS", crtVersion, "CRT KEY", serviceVersionKey, "=", svcVersion)
		return out, false, status.New(codes.Unavailable, "migration not passed yet").Err()
	} else {
		migStatusesLock.Lock()
		defer migStatusesLock.Unlock()
		migStatusesOK[serviceVersionKey] = struct{}{}
	}
	return
}
