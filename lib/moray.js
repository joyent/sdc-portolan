/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Moray backend stream
 */

var assert = require('assert-plus');
var stream = require('stream');
var util = require('util');
var common = require('./common.js');

var sprintf = util.format;


var SVP_OP_TYPES = [
    'unknown',
    'ping',
    'pong',
    'vl2_req',
    'vl2_ack',
    'vl3_req',
    'vl3_ack',
    'bulk_req',
    'bulk_ack',
    'log_req',
    'log_ack',
    'log_rm',
    'log_rack',
    'shootdown'
];

var SVP_STATUS = {
    'OK': 0,
    'FATAL': 1,
    'NOTFOUND': 2,
    'BADL3TYPE': 3,
    'BADBULK': 4,
    'BADLOG': 5,
    'LOGAGIN': 6
};



// -- API

function MorayStore(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.moray, 'opts.moray');
    assert.object(opts.log, 'opts.log');

    var self = this;
    if (!opts) {
        opts = {};
    }
    opts.objectMode = true;
    self.moray = opts.moray;
    self.log = opts.log;

    if (!this instanceof MorayStore) {
        return new MorayStore(opts);
    }

    stream.Transform.call(this, opts);
}
util.inherits(MorayStore, stream.Transform);


MorayStore.prototype._transform = function _transform(input, enc, cb) {
    var self = this;
    var type = input.svp_type;
    if (!type || type < 0 || type >= SVP_OP_TYPES.length) {
        return (cb(new Error('invalid type %s', type)));
    }

    var op = SVP_OP_TYPES[input.svp_type];
    var fn = '_op_' + op;
    if (!self[fn] || typeof (self[fn]) !== 'function') {
        return (cb(new Error('unknown operation %s', op)));
    }

    self[fn](input, function opDone(err, output) {
        if (err) {
            // TODO: better error handling
            return (cb(err));
        }

        output.svp_id = input.svp_id;
        self.push(output);
        return (cb());
    });
};


MorayStore.prototype._op_ping = function _op_ping(input, cb) {
    var output = {};
    var type  = SVP_OP_TYPES.indexOf('pong');
    if (type < 0) {
        return (cb(new Error('pong type not found')));
    }
    output.svp_type = type;

    return (cb(null, output));
};


MorayStore.prototype._op_vl2_req = function _op_vl2_req(input, cb) {
    var self = this;

    var output = {};
    var type  = SVP_OP_TYPES.indexOf('vl2_ack');
    if (type < 0) {
        return (cb(new Error('vl2_ack type not found')));
    }
    output.svp_type = type;

    var mac = input.svp_msg.vl2_mac;
    var vnet_id = input.svp_msg.vl2_vnet_id;

    var filter = sprintf('(&(mac=%s)(vid=%s))', mac, vnet_id);
    var opts = {};
    var req = self.moray.findObjects('vnet_mac_ip', filter, opts);

    req.once('error', function searchError(err) {
        self.log.error(err);
        return (cb(err));
    });

    req.on('record', function onRecord(obj) {
        if (obj.value.deleted) {
            return;
        }
        output.svp_msg = {
            vl2_status: SVP_STATUS.OK,
            vl2_port: common.VL_PORT,
            vl2_addr: common.stringToIp(obj.value.ip)
        };
    });

    req.once('end', function onEnd() {
        if (!output.svp_msg) {
            output.svp_msg = {
                vl2_status: SVP_STATUS.NOTFOUND
            };
        }
        return (cb(null, output));
    });
};


MorayStore.prototype._op_vl3_req = function _op_vl3_req(input, cb) {
    var self = this;

    var output = {};
    var type = SVP_OP_TYPES.indexOf('vl3_ack');
    if (type < 0) {
        return (cb(new Error('vl3_ack type not found')));
    }
    output.svp_type = type;

    var ip = input.svp_msg.vl3_ip;
    var vnet_id = input.svp_msg.vl3_vnet_id;

    var key = [ip, vnet_id].join(',');

    self.moray.getObject('vnet_mac_ip', key, function (err, obj) {
        if (err) {
            if (err.name === 'ObjectNotFoundError') {
                output.svp_msg = {
                    vl3_status: SVP_STATUS.NOTFOUND
                };
                return (cb(null, output));
            }
            self.log.error(err);
            return (cb(err));
        }

        output.svp_msg = {
            vl3_status: SVP_STATUS.OK,
            vl3_mac: obj.value.mac,
            vl3_port: common.VL_PORT,
            vl3_addr: common.stringToIp(obj.value.ip)
        };
        return (cb(null, output));
    });
};

module.exports = MorayStore;
