/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Portolan backend wrapper: "and me, the groove and my friends
 * are gonna try to move your feet"
 */

'use strict';

var assert = require('assert-plus');



// --- Exports



function loadBackend(config) {
    assert.object(config, 'config');
    assert.string(config.backend, 'config.backend');

    var newBackend = require('./' + config.backend);
    // Re-export all of the backend's exports
    for (var e in newBackend) {
        module.exports[e] = newBackend[e];
    }
}



module.exports = {
    load: loadBackend
};
