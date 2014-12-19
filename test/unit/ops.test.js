/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Test for basic server operations
 */

var backend = require('../../lib/backend');
var client = require('../../lib/client');
var portolan = require('../../lib/portolan');
var test = require('tape');



// --- Globals



var CLIENT;
var CONFIG = {
    backend: 'json',
    host: 'localhost',
    jsonDir: '/var/tmp/portolan-test-' + process.pid,
    logLevel: process.env.LOG_LEVEL || 'fatal',
    port: 51302
};
var SERVER;



// --- Setup



test('setup', function (t) {
    portolan.createServer(CONFIG, function _afterCreate(err, server) {
        t.ifErr(err, 'create server');
        if (!server) {
            return t.end();
        }

        SERVER = server;
        CLIENT = client.connect(CONFIG, function _afterConnect(err2) {
            t.ifErr(err2, 'client connect');
            t.end();
        });
    });
});



// --- Tests



test('ping', function (t) {
    CLIENT.ping(function _afterPing(err, res) {
        t.ifErr(err, 'ping');
        t.deepEqual(res, { status: 'ok' }, 'status');
        t.end();
    });
});



// --- Teardown



test('teardown', function (t) {
    if (SERVER) {
        SERVER.close();
    }

    if (CLIENT) {
        CLIENT.close();
    }

    t.end();
});
