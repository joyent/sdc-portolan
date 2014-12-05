/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var bunyan = require('bunyan');
var moray = require('moray');
var test = require('tape');

var common = require('../lib/common.js');
var Stream = require('../lib/moray.js');

var LOG = bunyan.createLogger({
    name: 'moray',
    level: 'INFO',
    stream: process.stdout,
    serializers: bunyan.stdSerializers
});

var CLIENT;

function createStream() {
    var stream = new Stream({
        moray: CLIENT,
        log: LOG
    });
    return (stream);
}

test('setup', function (t) {
    CLIENT = moray.createClient({
        host: process.env.MORAY_HOST || '127.0.0.1',
        port: process.env.MORAY_PORT || 2020,
        log: LOG
    });
    CLIENT.on('connect', function () {
        t.end();
    });
});

test('ping', function (t) {
    var stream = createStream();

    var obj = {
        svp_type: 1, // SVP_R_PING
        svp_id: 5
    };

    var expected = {
        svp_type: 2, // SVP_R_PONG
        svp_id: 5
    };

    stream.on('readable', function () {
        var actual = stream.read();
        t.deepEquals(actual, expected);
        t.end();
    });
    stream.end(obj);
});

test('vl2', function (t) {
    var stream = createStream();

    var obj = {
        svp_type: 3, // SVP_R_VL2_REQ
        svp_id: 7,
        svp_msg: {
            vl2_mac: common.macToInt('00:0a:95:9d:68:16'),
            vl2_vnet_id: 12340
        }
    };

    var expected = {
        svp_type: 4, // SVP_R_VL2_ACK
        svp_id: 7,
        svp_msg: {
            vl2_status: 0,
            vl2_port: 123,
            vl2_addr: common.stringToIp('192.168.1.1')
        }
    };

    stream.on('readable', function () {
        var actual = stream.read();
        t.deepEquals(actual, expected);
        t.end();
    });
    stream.end(obj);
});

test('vl3', function (t) {
    var stream = createStream();

    var obj = {
        svp_type: 5, // SVP_R_VL3_REQ
        svp_id: 7,
        svp_msg: {
            vl3_ip: common.stringToIp('10.0.0.1'),
            vl3_vnet_id: 12340
        }
    };

    var expected = {
        svp_type: 6, // SVP_R_VL3_ACK
        svp_id: 7,
        svp_msg: {
            vl3_status: 0,
            vl3_mac: common.macToInt('00:0a:95:9d:68:16'),
            vl3_port: 123,
            vl3_addr: common.stringToIp('192.168.1.1')
        }
    };

    stream.on('readable', function () {
        var actual = stream.read();
        t.deepEquals(actual, expected);
        t.end();
    });
    stream.end(obj);
});

test('teardown', function (t) {
    CLIENT.close();
    t.end();
});
