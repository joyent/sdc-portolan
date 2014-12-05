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
var lru = require('lru-cache');
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
    'log_rm_ack',
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

    self.vl2_cache = lru({
        max: 100,
        maxAge: 10 * 1000
    });

    self.vl3_cache = lru({
        max: 100,
        maxAge: 10 * 1000
    });

    self.cn_cache = lru({
        max: 100,
        maxAge: 5 * 60 * 1000
    });

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


MorayStore.prototype._get_cn = function _get_cn(cn, cb) {
    var self = this;

    var cached = self.cn_cache.get(cn);
    if (cached) {
        return (setImmediate(function () {
            cb(null, cached);
        }));
    }

    self.moray.getObject('portolan_underlay_mappings', cn, function (err, obj) {
        if (err) {
            return (cb(err));
        }
        self.cn_cache.set(cn, obj.value);
        return (cb(null, obj.value));
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

    var mac = input.svp_msg.vl2_mac;
    var vnet_id = input.svp_msg.vl2_vnet_id;
    var key = [mac, vnet_id].join(',');

    var cached = self.vl2_cache.get(key);
    if (cached) {
        return (setImmediate(function () {
            cb(null, cached);
        }));
    }

    var output = {};
    var type  = SVP_OP_TYPES.indexOf('vl2_ack');
    if (type < 0) {
        return (cb(new Error('vl2_ack type not found')));
    }
    output.svp_type = type;

    var mapping;
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
        mapping = obj.value;
    });

    req.once('end', function onEnd() {
        if (!mapping) {
            output.svp_msg = {
                vl2_status: SVP_STATUS.NOTFOUND
            };
            self.vl2_cache.set(key, output);
            return (cb(null, output));
        }
        self._get_cn(mapping.cn_id, function gotCn(err, cn) {
            if (err) {
                self.log.error(err);
                return (cb(err));
            }
            output.svp_msg = {
                vl2_status: SVP_STATUS.OK,
                vl2_port: cn.port,
                vl2_addr: common.stringToIp(cn.ip)
            };
            self.vl2_cache.set(key, output);
            return (cb(null, output));
        });
    });
};


MorayStore.prototype._op_vl3_req = function _op_vl3_req(input, cb) {
    var self = this;

    var ip = common.ipToString(input.svp_msg.vl3_ip);
    var vnet_id = input.svp_msg.vl3_vnet_id;
    var key = [ip, vnet_id].join(',');

    var cached = self.vl3_cache.get(key);
    if (cached) {
        return (setImmediate(function () {
            cb(null, cached);
        }));
    }

    var output = {};
    var type = SVP_OP_TYPES.indexOf('vl3_ack');
    if (type < 0) {
        return (cb(new Error('vl3_ack type not found')));
    }
    output.svp_type = type;

    self.moray.getObject('vnet_mac_ip', key, function (err, obj) {
        if (err) {
            if (err.name === 'ObjectNotFoundError') {
                output.svp_msg = {
                    vl3_status: SVP_STATUS.NOTFOUND
                };
                self.vl3_cache.set(key, output);
                return (cb(null, output));
            }
            self.log.error(err);
            return (cb(err));
        }

        var mapping = obj.value;

        self._get_cn(mapping.cn_id, function (cn_err, cn) {
            if (cn_err) {
                self.log.error(cn_err);
                return (cb(cn_err));
            }

            output.svp_msg = {
                vl3_status: SVP_STATUS.OK,
                vl3_mac: mapping.mac,
                vl3_uport: cn.port,
                vl3_uaddr: common.stringToIp(cn.ip)
            };

            self.vl3_cache.set(key, output);
            return (cb(null, output));
        });
    });
};

module.exports = MorayStore;
