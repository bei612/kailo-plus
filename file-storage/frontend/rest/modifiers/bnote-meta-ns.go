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

package modifiers

import (
	"context"
	"time"

	"go.uber.org/zap"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/proto/idm"
	service2 "github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/telemetry/log"
	"github.com/pydio/cells/v5/common/utils/std"
)

func RetryCreatePagesNamespaces(ctx context.Context) error {
	return std.Retry(ctx, func() error {
		return CreatePagesNamespaces(ctx)
	}, 3*time.Second, 30*time.Second)
}

func CreatePagesNamespaces(ctx context.Context) error {
	cli := idm.NewUserMetaServiceClient(grpc.ResolveConn(ctx, common.ServiceUserMetaGRPC))
	c, can := context.WithCancel(ctx)
	defer can()
	resp, e := cli.ListUserMetaNamespace(c, &idm.ListUserMetaNamespaceRequest{})
	if e == nil {
		for {
			r, er := resp.Recv()
			if er != nil {
				break
			}
			if r.UserMetaNamespace.Namespace == "usermeta-page-content" {
				return nil
			}
		}
	}
	_, e = cli.UpdateUserMetaNamespace(ctx, &idm.UpdateUserMetaNamespaceRequest{
		Operation: idm.UpdateUserMetaNamespaceRequest_PUT,
		Namespaces: []*idm.UserMetaNamespace{
			{
				Namespace:      "usermeta-page-content",
				Label:          "Page Contents",
				Order:          12,
				Indexable:      false,
				JsonDefinition: `{"type":"json", "groupName": "Internal"}`,
				Policies: []*service2.ResourcePolicy{{
					Action:  service2.ResourcePolicyAction_READ,
					Subject: "*",
					Effect:  service2.ResourcePolicy_allow,
				}, {
					Action:  service2.ResourcePolicyAction_WRITE,
					Subject: "*",
					Effect:  service2.ResourcePolicy_allow,
				}},
			},
			{
				Namespace:      "usermeta-is-page",
				Label:          "Is Page",
				Order:          13,
				Indexable:      false,
				JsonDefinition: `{"type":"json", "groupName": "Internal"}`,
				Policies: []*service2.ResourcePolicy{{
					Action:  service2.ResourcePolicyAction_READ,
					Subject: "*",
					Effect:  service2.ResourcePolicy_allow,
				}, {
					Action:  service2.ResourcePolicyAction_WRITE,
					Subject: "*",
					Effect:  service2.ResourcePolicy_allow,
				}},
			},
			{
				Namespace:      "usermeta-page-abstract",
				Label:          "Abstract",
				Order:          12,
				Indexable:      false,
				JsonDefinition: `{"type":"json", "groupName": "Internal"}`,
				Policies: []*service2.ResourcePolicy{{
					Action:  service2.ResourcePolicyAction_READ,
					Subject: "*",
					Effect:  service2.ResourcePolicy_allow,
				}, {
					Action:  service2.ResourcePolicyAction_WRITE,
					Subject: "*",
					Effect:  service2.ResourcePolicy_allow,
				}},
			},
		},
	})
	if e != nil {
		log.Logger(ctx).Error("Error while creating namespace plugin", zap.Error(e))
	}
	return nil
}
