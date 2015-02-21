/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Moray-related functions
 */

var assert = require('assert-plus');
var mod_moray = require('moray');



// --- Exports



function createMorayClient(config, callback) {
    assert.object(config, 'config');
    assert.object(config.moray, 'config.moray');
    assert.object(config.log, 'config.log');
    assert.func(callback, 'callback');

    var client = mod_moray.createClient({
        host: config.moray.host,
        port: config.moray.port,
        log: config.log
    });

    // XXX: Possible to get an error event here?

    client.once('connect', function _afterConnect() {
        return callback(null, client);
    });
}



module.exports = {
    createClient: createMorayClient
};
