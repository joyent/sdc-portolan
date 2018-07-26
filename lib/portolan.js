/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * Portolan server object
 */

'use strict';

var assert = require('assert-plus');
var bunyan = require('bunyan');
var backend = require('./backend');
var createMetricsManager = require('triton-metrics').createMetricsManager;
var fmt = require('util').format;
var net = require('net');
var restify = require('restify');
var SerializerStream = require('./serialize');
var SVPparser = require('./parser');
var SVPFramer = require('./framer');

var METRICS_SERVER_PORT = 8881;


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

    var metricsManager = createMetricsManager({
        address: config.adminIp,
        log: config.log,
        staticLabels: {
            datacenter: config.datacenter,
            instance: config.instanceUuid,
            server: config.serverUuid,
            service: config.serviceName
        },
        port: config.metricsPort || METRICS_SERVER_PORT,
        restify: restify
    });

    var requestCounter = metricsManager.collector.counter({
        name: 'svp_requests_completed',
        help: 'count of requests completed'
    });

    var requestHistogram = metricsManager.collector.histogram({
        name: 'svp_request_duration_seconds',
        help: 'total time to process requests'
    });

    metricsManager.createMetrics('portolan', function _collectMetrics(metrics) {
        var labels = metrics.labels;
        var timer = metrics.timer;

        var duration = process.hrtime(timer);
        var durationSeconds = (duration[0] * 1e9 + duration[1]) / 1e9;

        requestCounter.increment(labels);
        requestHistogram.observe(durationSeconds, labels);
    });

    metricsManager.listen(function () {});

    backend.init(config, function _afterBackendInit(initErr) {
        if (initErr) {
            if (callback) {
                callback(initErr);
                return;
            }

            throw initErr;
        }

        var server = net.createServer(function (conn) {
            var streamOpts = {
                log: log.child({
                    client: fmt('%s:%s', conn.remoteAddress, conn.remotePort)
                }),
                metricsManager: metricsManager
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
                server.metricsManager = metricsManager;
                callback(null, server);
                return;
            }
        });
    });
}



module.exports = {
    createServer: createServer
};
