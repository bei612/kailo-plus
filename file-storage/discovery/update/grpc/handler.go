/*
 * Copyright (c) 2024. Abstrium SAS <team (at) pydio.com>
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

package grpc

import (
	"context"

	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/update"
)

// Kailo (DD-133(1), DD-138(7), .design/07 §4.8.1 "帮助、关于" row): this
// artifact is built, released and deployed by Kailo (ADR-20 release entry),
// so the upstream in-place software update and edition upgrade are closed on
// the server, not only removed from the console. Neither method contacts the
// upstream update server or replaces the running binary; the admin console no
// longer has an entry for them (frontend/rest/settings.go, access.settings).
const kailoReleaseManaged = "software updates are released by the platform; in-place update and upgrade are disabled"

type Handler struct {
	update.UnimplementedUpdateServiceServer
}

// UpdateRequired never queries the upstream update server.
func (h *Handler) UpdateRequired(ctx context.Context, request *update.UpdateRequest) (*update.UpdateResponse, error) {
	return nil, errors.WithMessage(errors.StatusForbidden, kailoReleaseManaged)
}

// ApplyUpdate never downloads or installs an upstream binary.
func (h *Handler) ApplyUpdate(ctx context.Context, request *update.ApplyUpdateRequest) (*update.ApplyUpdateResponse, error) {
	return nil, errors.WithMessage(errors.StatusForbidden, kailoReleaseManaged)
}
