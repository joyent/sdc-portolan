/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

var config = require('./config');
var mod_client = require('../../lib/client');
var mod_log = require('./log');



// --- Globals



var CLIENT;



// --- Exports



function closeClient() {
    if (!CLIENT) {
        return;
    }

    CLIENT.close();
}


function getClient(callback) {
    if (CLIENT) {
        return callback(null, CLIENT);
    }

    var clientConfig = {
        log: mod_log.child({ component: 'client' }),
        host: process.env.PORTOLAN_HOST || 'localhost',
        port: config.port
    };

    CLIENT = mod_client.connect(clientConfig, function (cErr) {
        if (cErr) {
            throw cErr;
        }

        return callback(null, CLIENT);
    });
}



module.exports = {
    close: closeClient,
    get: getClient
};
