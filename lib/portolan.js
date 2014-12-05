/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Portolan server object
 */

var assert = require('assert-plus');
var bunyan = require('bunyan');
var backend = require('./backend/json');
var net = require('net');
var SerializerStream = require('./serialize');
var SVPparser = require('./parser');



// --- Exports



function createServer(config) {
    assert.object(config, 'config');
    assert.string(config.backend, 'config.backend');
    assert.string(config.logLevel, 'config.logLevel');
    assert.number(config.port, 'config.port');

    var initFn;
    var log = bunyan.createLogger({
        name: 'portolan',
        level: config.logLevel
    });

    assert.equal(config.backend, 'json');
    // XXX: For other backends, just change what the
    // backend module points to
    backend.init(config, function _afterBackendInit(initErr) {
        if (initErr) {
            throw initErr;
        }

        var server = net.createServer(function (conn) {
            var streamOpts = {
                log: log
            };
            conn.pipe(new SVPparser(streamOpts))
                .pipe(new backend.Stream(streamOpts))
                .pipe(new SerializerStream(streamOpts))
                .pipe(conn);
        });

        server.listen(config.port, function _afterListen() {
            var addr = server.address();
            log.info(addr, 'server listening');
        });
    });
}



module.exports = {
    createServer: createServer
};
