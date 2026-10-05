/*
 * Copyright 2025 Abstrium SAS <team (at) pyd.io>
 * This file is part of Pydio.
 *
 * Pydio is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Pydio is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Pydio.  If not, see <http://www.gnu.org/licenses/>.
 *
 * The latest code can be found at <https://pydio.com>.
 */

import {NodeServiceApi} from 'cells-sdk-ts'
import axios from "axios";
import PydioApi from 'pydio/http/api'

/**
 *
 * @param pydio
 * @returns {Promise<NodeServiceApi>}
 * @constructor
 */
export const NodeServiceApiFactory = (pydio) => {
    return PydioApi.getRestClient().getOrUpdateJwt().then(token => {
        const frontU = pydio.getFrontendUrl();
        const url = `${frontU.protocol}//${frontU.host}`;
        const baseURL = url + pydio.Parameters.get('ENDPOINT_REST_API_V2');
        const instance = axios.create({
            baseURL,
            timeout: 3000,
            headers: {
                Authorization:'Bearer ' + token
            }
        });
        return new NodeServiceApi(undefined, undefined, instance)
    })
}