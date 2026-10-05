/*
 * Copyright (c) 2019-2021. Abstrium SAS <team (at) pydio.com>
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

package runtime

import (
	"context"

	"github.com/pydio/cells/v5/common/utils/propagator"
)

type serviceNameKey struct{}

type serviceVersionKey struct{}

var (
	ServiceNameKey    = serviceNameKey{}
	ServiceVersionKey = serviceVersionKey{}
)

func init() {
	propagator.RegisterKeyInjector[string](ServiceNameKey)
}

// WithServiceName returns a context which knows its service name
func WithServiceName(ctx context.Context, serviceName string) context.Context {
	return context.WithValue(ctx, ServiceNameKey, serviceName)
}

// GetServiceName returns the service name associated to this context
func GetServiceName(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if v := ctx.Value(ServiceNameKey); v == nil {
		return ""
	} else if name, ok := v.(string); ok {
		return name
	} else {
		return ""
	}
}

// WithServiceVersionKey overrides the default name used to read/write service version
func WithServiceVersionKey(ctx context.Context, versionKey string) context.Context {
	return context.WithValue(ctx, ServiceVersionKey, versionKey)
}

// GetServiceVersionKey returns the service name or custom service version key
func GetServiceVersionKey(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if v := ctx.Value(ServiceVersionKey); v != nil {
		return v.(string)
	}
	return GetServiceName(ctx)
}
