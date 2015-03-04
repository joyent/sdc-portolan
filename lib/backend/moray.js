/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Moray backend stream
 */

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


function getClient() {
    if (SHARED.moray) {
        return SHARED.moray;
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
            return callback(err);
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

    if (!this instanceof MorayStore) {
        return new MorayStore(opts);
    }

    stream.Transform.call(this, opts);
}
util.inherits(MorayStore, stream.Transform);


MorayStore.prototype._transform = function _transform(input, enc, callback) {
    var log = common.childLogger(this.log, input);

    log.debug({ message: input }, 'moray store message');

    var self = this;
    var type = input.svp_type;
    if (!type || !types.svp_op_names[type]) {
        return callback(new Error('invalid type %s', type));
    }

    var op = types.svp_op_names[type].toLowerCase();
    var fn = '_op_' + op;
    if (!self[fn] || typeof (self[fn]) !== 'function') {
        return callback(new Error('unknown operation %s', op));
    }

    self[fn](input, log, function opDone(err, output) {
        if (err) {
            // XXX: push a SVP_S_FATAL reply?
            return callback(err);
        }

        output.svp_id = input.svp_id;
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
        moray: this.moray
    }, callback);
};


MorayStore.prototype._op_svp_r_ping =
        function _op_svp_r_ping(input, log, callback) {
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
                return callback(null, common.vl2NotFoundMsg(input));
            }

            return callback(vl2Err);
        }

        self._get_cn(mapping.cn_uuid, function gotCn(cnErr, cn) {
            if (cnErr) {
                log.error(cnErr, 'CN mapping not found');
                return callback(cnErr);
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
                return callback(null, common.vl3NotFoundMsg(input));
            }

            return callback(vl3Err);
        }

        self._get_cn(mapping.cn_uuid, function (cnErr, cn) {
            if (cnErr) {
                log.error(cnErr, 'CN mapping not found');
                return callback(cnErr);
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
    getClient: getClient,
    init: init,

    addOverlayMapping: addOverlayMapping,
    updateOverlayMapping: updateOverlayMapping,
    removeOverlayMapping: removeOverlayMapping,

    addUnderlayMapping: addUnderlayMapping,
    updateUnderlayMapping: updateUnderlayMapping,
    removeUnderlayMapping: removeUnderlayMapping
};
