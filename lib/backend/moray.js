/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * Moray backend stream
 */

'use strict';

var assert = require('assert-plus');
var clone = require('clone');
var common = require('../common');
var mod_moray = require('../moray');
var mod_portolan_moray = require('portolan-moray');
var stream = require('stream');
var types = require('../types');
var util = require('util');
var vasync = require('vasync');



// --- Globals



/*
 * A shared object so each new stream can use the same moray connection
 */
var SHARED = {};



// -- API


function closeClient() {
    if (SHARED.moray) {
        SHARED.moray.close();
    }
}


/**
 * Initialize the moray client and the portolan moray module's caches
 */
function init(config, callback) {
    assert.object(config, 'config');
    assert.func(callback, 'callback');

    mod_moray.createClient(config, function _afterClient(err, client) {
        if (err) {
            callback(err);
            return;
        }

        SHARED.moray = client;
        mod_portolan_moray.initConsumer(config, callback);
    });

    return SHARED;
}


/**
 * Return a moray lookup transform stream
 */
function createStream(opts) {
    if (!SHARED.moray) {
        throw new Error('init must be called before creating streams');
    }

    return new MorayStore({
        log: opts.log,
        moray: SHARED.moray
    });
}


/**
 * Constructor for the moray lookup transform stream
 */
function MorayStore(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.object(opts.moray, 'opts.moray');

    var self = this;
    if (!opts) {
        opts = {};
    }
    opts.objectMode = true;

    self.moray = opts.moray;
    self.log = opts.log;

    stream.Transform.call(this, opts);
}
util.inherits(MorayStore, stream.Transform);


MorayStore.prototype._transform = function _transform(input, _enc, callback) {
    var log = common.childLogger(this.log, input);

    log.debug({ message: input }, 'moray store message');

    var self = this;
    var type = input.svp_type;
    if (!type || !types.svp_op_names[type]) {
        callback(new Error('invalid type %s', type));
        return;
    }

    var op = types.svp_op_names[type].toLowerCase();
    var fn = '_op_' + op;
    if (!self[fn] || typeof (self[fn]) !== 'function') {
        callback(new Error('unknown operation %s', op));
        return;
    }

    self[fn](input, log, function opDone(err, output) {
        if (err) {
            log.error(err, 'Failed to generate response, sending fatal reply');
            output = common.fatalResponse(type);
        }

        output.svp_id = input.svp_id;
        output.metrics = input.metrics;
        common.addLogOpts(log, output);

        self.push(output);
        return callback();
    });
};


/**
 * Get a CN underlay mapping
 */
MorayStore.prototype._get_cn = function _get_cn(cn, callback) {
    mod_portolan_moray.underlayLookup({
        cn_uuid: cn,
        moray: this.moray,
        log: this.log
    }, callback);
};

MorayStore.prototype._get_cn_by_ip = function _get_by_ip(ip, callback) {
    mod_portolan_moray.underlayLookupByIp({
        ip: ip,
        moray: this.moray,
        log: this.log
    }, callback);
};

MorayStore.prototype._op_svp_r_ping =
    function _op_svp_r_ping(_input, _log, callback) {
    var type  = types.svp_op.SVP_R_PONG;
    var output = {
        svp_type: type
    };
    // XXX: should this do a moray ping?

    return callback(null, output);
};


MorayStore.prototype._op_svp_r_vl2_req =
    function _op_svp_r_vl2_req(input, log, callback) {
    var self = this;

    mod_portolan_moray.vl2Lookup({
        log: log,
        moray: self.moray,
        vl2_mac: input.svp_msg.vl2_mac,
        vl2_vnet_id: input.svp_msg.vl2_vnet_id
    }, function (vl2Err, mapping) {
        if (vl2Err) {
            if (vl2Err.code === 'ENOENT') {
                log.debug('vl2 mapping not found');
                callback(null, common.vl2NotFoundMsg(input));
                return;
            }

            callback(vl2Err);
            return;
        }

        self._get_cn(mapping.cn_uuid, function gotVl2Cn(cnErr, cn) {
            if (cnErr) {
                log.error(cnErr, 'CN mapping not found');
                return callback(null, common.vl2NotFoundMsg(input));
            }

            var output = {
                svp_msg: {
                    vl2_status: types.svp_status.SVP_S_OK,
                    vl2_port: cn.port,
                    vl2_addr: common.stringToIp(cn.ip)
                },
                svp_type: types.svp_op.SVP_R_VL2_ACK
            };

            return callback(null, output);
        });
    });
};


MorayStore.prototype._op_svp_r_vl3_req =
    function _op_svp_r_vl3_req(input, log, callback) {
    var self = this;

    mod_portolan_moray.vl3Lookup({
        log: log,
        moray: self.moray,
        vl3_ip: common.ipToString(input.svp_msg.vl3_ip),
        vl3_vnet_id: input.svp_msg.vl3_vnet_id
    }, function (vl3Err, mapping) {
        if (vl3Err) {
            if (vl3Err.code === 'ENOENT') {
                log.debug('vl3 mapping not found');
                callback(null, common.vl3NotFoundMsg(input));
                return;
            }

            callback(vl3Err);
            return;
        }

        self._get_cn(mapping.cn_uuid, function (cnErr, cn) {
            if (cnErr) {
                log.error(cnErr, 'CN mapping not found');
                return callback(null, common.vl3NotFoundMsg(input));
            }

            var output = {
                svp_msg: {
                    vl3_status: types.svp_status.SVP_S_OK,
                    vl3_mac: mapping.mac,
                    vl3_port: cn.port,
                    vl3_addr: common.stringToIp(cn.ip)
                },
                svp_type: types.svp_op.SVP_R_VL3_ACK
            };

            return callback(null, output);
        });
    });
};


MorayStore.prototype._op_svp_r_log_req =
    function _op_svp_r_log_req(input, log, callback) {

    var self = this;
    var lr_ip = common.ipToString(input.svp_msg.lr_ip);

    self._get_cn_by_ip(lr_ip, function (ulErr, mapping) {
        if (ulErr) {
            if (ulErr.code === 'ENOENT') {
                log.error(ulErr, 'mapping not found for ip=%s', lr_ip);
                callback(ulErr);
                return;
            }

            callback(ulErr);
            return;
        }

        log.debug({ ulErr: ulErr, ip: lr_ip, mapping: mapping },
            'logreq mapped cn ip');

        // This is an upper limit, based on the smallest possible size of logs.


        var limit = Math.floor(
            input.svp_msg.lr_count /
            Math.min(types.sizeof.SVP_LOG_VL2,
                types.sizeof.SVP_LOG_VL3));

        log.debug({ input: input, bytes: input.svp_msg.lr_count,
            vl2: types.sizeof.SVP_LOG_VL2, vl3: types.sizeof.SVP_LOG_VL3,
            limit: limit }, 'calculating log limit');


        mod_portolan_moray.logReq({
            cnUuid: mapping.cn_uuid,
            limit: limit,
            log: log,
            moray: self.moray
        }, function (logErr, logs) {
            if (logErr) {
                callback(logErr);
                return;
            }

            var bytes = 0;

            log.debug({ logs: logs }, 'log_req found messages');

            var output = {
                svp_msg: {
                    log_status: types.svp_status.SVP_S_OK,
                    log_data: []
                },
                svp_type: types.svp_op.SVP_R_LOG_ACK
            };

            for (var i = 0; i < logs.length; i++) {
                // enforce the real limit based on actual logs returned.
                bytes += types.sizeof[logs[i].record.type];
                if (bytes > input.svp_msg.lr_count) {
                    break;
                }

                if (logs[i].record.type === 'SVP_LOG_VL3') {
                    logs[i].record.ip = common.stringToIp(logs[i].record.ip);
                }
                output.svp_msg.log_data.push(logs[i]);
            }

            callback(null, output);
        });
    });
};

MorayStore.prototype._op_svp_r_log_rm =
    function _op_svp_r_log_rm(input, log, callback) {

    var self = this;

    var queue = vasync.forEachParallel({
        inputs: input.svp_msg.rr_ids,
        func: function _logRm(uuid, cb) {
            mod_portolan_moray.logRm({
                uuid: uuid,
                log: log,
                moray: self.moray
            }, cb);
        }
    }, function doneRm(err, _) {
        log.debug({ err: err, queue: queue }, 'logrm completed');
        if (err) {
            return callback(err);
        }
        return callback(null, {
            svp_msg: {
                ra_status: types.svp_status.SVP_S_OK
            },
            svp_type: types.svp_op.SVP_R_LOG_RM_ACK
        });
    });
};


// --- Backend manipulation



function addOverlayMapping(opts, callback) {
    assert.object(opts, 'opts');
    assert.func(callback, 'callback');

    var newOpts = clone(opts);
    newOpts.ip = common.ipToString(opts.ip);
    newOpts.moray = SHARED.moray;

    return mod_portolan_moray.addOverlayMapping(newOpts, callback);
}


function updateOverlayMapping(opts, callback) {
    assert.object(opts, 'opts');
    assert.func(callback, 'callback');

    var newOpts = clone(opts);
    newOpts.ip = common.ipToString(opts.ip);
    newOpts.moray = SHARED.moray;

    return mod_portolan_moray.updateOverlayMapping(newOpts, callback);
}


function removeOverlayMapping(opts, callback) {
    assert.object(opts, 'opts');
    assert.func(callback, 'callback');

    var newOpts = clone(opts);
    newOpts.ip = common.ipToString(opts.ip);
    newOpts.moray = SHARED.moray;

    return mod_portolan_moray.removeOverlayMapping(newOpts, callback);
}


function addUnderlayMapping(opts, callback) {
    assert.object(opts, 'opts');
    assert.func(callback, 'callback');

    var newOpts = clone(opts);
    newOpts.ip = common.ipToString(opts.ip);
    newOpts.moray = SHARED.moray;

    return mod_portolan_moray.addUnderlayMapping(newOpts, callback);
}


function updateUnderlayMapping(opts, callback) {
    assert.object(opts, 'opts');
    assert.func(callback, 'callback');

    var newOpts = clone(opts);
    if (opts.ip) {
        newOpts.ip = common.ipToString(opts.ip);
    }
    newOpts.moray = SHARED.moray;

    return mod_portolan_moray.updateUnderlayMapping(newOpts, callback);
}


function removeUnderlayMapping(opts, callback) {
    assert.object(opts, 'opts');
    assert.func(callback, 'callback');

    var newOpts = clone(opts);
    newOpts.moray = SHARED.moray;

    return mod_portolan_moray.removeUnderlayMapping(newOpts, callback);
}



module.exports = {
    close: closeClient,
    createStream: createStream,
    init: init,

    addOverlayMapping: addOverlayMapping,
    updateOverlayMapping: updateOverlayMapping,
    removeOverlayMapping: removeOverlayMapping,

    addUnderlayMapping: addUnderlayMapping,
    updateUnderlayMapping: updateUnderlayMapping,
    removeUnderlayMapping: removeUnderlayMapping
};
