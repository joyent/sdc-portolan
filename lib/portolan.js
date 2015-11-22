/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Portolan server object
 */

var assert = require('assert-plus');
var bunyan = require('bunyan');
var backend = require('./backend');
var fmt = require('util').format;
var net = require('net');
var SerializerStream = require('./serialize');
var SVPparser = require('./parser');
var SVPFramer = require('./framer');



// --- Exports



function createServer(config, callback) {
    assert.object(config, 'config');
    assert.string(config.logLevel, 'config.logLevel');
    assert.number(config.port, 'config.port');

    var log = bunyan.createLogger({
        name: 'portolan',
        level: config.logLevel
    });

    backend.load(config);
    config.log = log;

    backend.init(config, function _afterBackendInit(initErr) {
        if (initErr) {
            if (callback) {
                return callback(initErr);
            }

            throw initErr;
        }

        var server = net.createServer(function (conn) {
            var streamOpts = {
                log: log.child({
                    client: fmt('%s:%s', conn.remoteAddress, conn.remotePort)
                })
            };
            conn.pipe(new SVPFramer(streamOpts))
                .pipe(new SVPparser(streamOpts))
                .pipe(backend.createStream(streamOpts))
                .pipe(new SerializerStream(streamOpts))
                .pipe(conn);
        });

        server.listen(config.port, function _afterListen() {
            var addr = server.address();
            log.info(addr, 'server listening');
            if (callback) {
                return callback(null, server);
            }
        });
    });
}



module.exports = {
    createServer: createServer
};
