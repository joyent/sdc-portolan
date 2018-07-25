/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

'use strict';

var assert = require('assert-plus');



// --- Exports



assert.ok(process.env.MORAY_HOST,
    'MORAY_HOST environment variable must be set');


/**
 * Test server config
 */
var SERVER_CONFIG = {
    adminIp: process.env.ADMIN_IP || '127.0.0.1',
    backend: 'moray',
    datacenter: 'test-datacenter',
    instanceUuid: 'test-instanceUuid',
    logLevel: process.env.LOG_LEVEL || 'fatal',
    metricsPort: process.env.metricsPort || 8882,
    moray: {
        host: process.env.MORAY_HOST,
        port: process.env.MORAY_PORT || 2020
    },
    port: parseInt(process.env.PORTOLAN_PORT) || 1296,
    serverUuid: 'test-serverUuid',
    serviceName: 'portolan'
};



module.exports = SERVER_CONFIG;
