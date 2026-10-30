/*
 * Copyright 2007-2017 Charles du Jeu - Abstrium SAS <team (at) pyd.io>
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

import {pydio} from '../globals'

export default function () {

    // Kailo (DD-138(6), 07 §4.8.5): the native console is not reachable from
    // any business page; its functions are Kailo admin surfaces.
    if(window.KailoCells && window.KailoCells.kailoMode && window.KailoCells.kailoMode()){
        return;
    }
    if(!pydio.repositoryId || pydio.repositoryId !== "settings"){
        pydio.triggerRepositoryChange('settings');
    }

}