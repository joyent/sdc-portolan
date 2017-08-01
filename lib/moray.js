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

'use strict';

var assert = require('assert-plus');
var clone = require('clone');
var mod_moray = require('moray');



// --- Exports



function createMorayClient(config, callback) {
    assert.object(config, 'config');
    assert.object(config.moray, 'config.moray');
    assert.object(config.log, 'config.log');
    assert.func(callback, 'callback');

    var cfg = clone(config.moray);
    cfg.log = config.log.child({
        component: 'moray',
        level: config.moray.logLevel || 'info'
    });

    var client = mod_moray.createClient(cfg);

    client.once('connect', function _afterConnect() {
        return callback(null, client);
    });
}



module.exports = {
    createClient: createMorayClient
};
