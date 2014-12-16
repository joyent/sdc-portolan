/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Bootstraps Moray with some data used in backend tests.
 */

var backend = require('../../lib/backend/moray');
var bunyan = require('bunyan');
var config = require('../../etc/config');
var moray = require('moray');
var vasync = require('vasync');

var common = require('../../lib/common.js');

var log = bunyan.createLogger({
    name: 'moray',
    level: 'INFO',
    stream: process.stdout,
    serializers: bunyan.stdSerializers
});
config.log = log;

var overlay = [
    {
        value: {
            mac: common.macToInt('00:0a:95:9d:68:16'),
            ip: common.IPv6obj('10.0.0.1'),
            cn_id: 'b4e5ff64-7b40-11e4-a6fa-d34c824a42cd',
            vid: 12340,
            deleted: false
        }
    }
];

overlay.forEach(function (rec) {
    rec.key = [rec.value.ip.toString(), rec.value.vid].join(',');
});

var underlay = [
    {
        key: 'b4e5ff64-7b40-11e4-a6fa-d34c824a42cd',
        value: {
            cn_id: 'b4e5ff64-7b40-11e4-a6fa-d34c824a42cd',
            ip: common.IPv6obj('192.168.1.1'),
            port: 123
        }
    }
];

function setup(cb) {
    vasync.pipeline({funcs:[
        function createBuckets(_, pipelinecb) {
            backend.init(config, pipelinecb);
        },

        function insertUnderlay(_, pipelinecb) {
            vasync.forEachPipeline({
                func: function insertUnderlayRec(rec, recCb) {
                    backend.addUnderlayMapping(rec.value, recCb);
                },
                inputs: underlay
            }, pipelinecb);
        },

        function insertOverlay(_, pipelinecb) {
            vasync.forEachPipeline({
                func: function insertOverlayRec(rec, recCb) {
                    backend.addOverlayMapping(rec.value, recCb);
                },
                inputs: overlay
            }, pipelinecb);
        }

    ]}, function (err) {
        if (err) {
            console.log(err);
        }
        cb();
    });
}


function teardown(cb) {
    vasync.pipeline({funcs:[
        function delBuckets(_, pipelinecb) {
            vasync.forEachPipeline({
                func: function delbucket(bucket, bucketcb) {
                    console.log('deleting bucket ' + bucket.name);
                    client.delBucket(bucket.name, bucketcb);
                },
                inputs: tables
            }, pipelinecb);
        }
    ]}, function (err) {
        if (err) {
            console.log(err);
        }
        cb();
    });
}


function main() {
    if (process.argv[2] === 'setup') {
        setup(backend.close);
    } else if (process.argv[2] === 'teardown') {
        teardown(backend.close);
    } else {
        console.error('usage: ' + process.argv[1] + ' [setup|teardown]');
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
