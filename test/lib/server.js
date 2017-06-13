/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

'use strict';

var config = require('./config');
var mod_client = require('./client');
var mod_log = require('./log');
var mod_moray = require('../../lib/backend/moray');
var mod_server = require('../../lib/portolan');



// --- Exports



var SERVER;



// --- Exports



/**
 * Get the test server
 */
function getServer() {
    return SERVER;
}


/**
 * Create and start the test server
 */
function startServer(t) {
    config.log = mod_log.child({ component: 'server' });

    mod_server.createServer(config, function _afterCreate(cErr, server) {
        t.ifErr(cErr, 'create server');
        if (cErr) {
            throw cErr;
        }

        SERVER = server;
        return t.end();
    });
}


/**
 * Create and start the test server
 */
function stopServer(t) {
    mod_client.close(t);

    if (SERVER) {
        SERVER.close();
        t.ok(true, 'Server closed');
    } else {
        t.ok(true, 'No server created: not closing');
    }

    mod_moray.close();
    t.ok(true, 'moray client closed');

    return t.end();
}



module.exports = {
    get: getServer,
    start: startServer,
    stop: stopServer
};
