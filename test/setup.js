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

var bunyan = require('bunyan');
var moray = require('moray');
var vasync = require('vasync');

var common = require('../lib/common.js');

var client = moray.createClient({
    host: process.env.MORAY_HOST || '127.0.0.1',
    port: process.env.MORAY_PORT || 2020,
    log: bunyan.createLogger({
        name: 'moray',
        level: 'INFO',
        stream: process.stdout,
        serializers: bunyan.stdSerializers
    })
});

var vnet_mac_ip = {
    name: 'vnet_mac_ip',
    cfg: {
        index: {
            mac: {
                type: 'number'
            },
            ip: {
                type: 'string'
            },
            cn_id: {
                type: 'string'
            },
            vid: {
                type: 'number'
            },
            version: {
                type: 'number'
            },
            deleted: {
                type: 'boolean'
            }
        },
        options: {
            version: 0
        }
    }
};

var tables = [
    vnet_mac_ip
];

var rows = [
    {
        bucket: 'vnet_mac_ip',
        key: '10.0.0.1,12340',
        value: {
            mac: common.macToInt('00:0a:95:9d:68:16'),
            ip: '10.0.0.1',
            'cn_id': 'b4e5ff64-7b40-11e4-a6fa-d34c824a42cd',
            vid: 12340,
            deleted: false
        }
    }
];

function setup(cb) {
    vasync.pipeline({funcs:[
        function createBuckets(_, pipelinecb) {
            vasync.forEachPipeline({
                func: function createBucket(bucket, bucketcb) {
                    console.log('creating bucket ' + bucket.name);
                    client.createBucket(bucket.name, bucket.cfg, bucketcb);
                },
                inputs: tables
            }, pipelinecb);
        },
        function insertRows(_, pipelinecb) {
            vasync.forEachPipeline({
                func: function insertRow(row, rowcb) {
                    console.log('inserting row ' + row.key);
                    client.putObject(row.bucket, row.key, row.value, rowcb);
                },
                inputs: rows
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
    client.on('connect', function () {
        if (process.argv[2] === 'setup') {
            setup(client.close.bind(client));
        } else if (process.argv[2] === 'teardown') {
            teardown(client.close.bind(client));
        } else {
            console.error('usage: ' + process.argv[1] + ' [setup|teardown]');
            process.exit(1);
        }
    });
}

if (require.main === module) {
    main();
}
