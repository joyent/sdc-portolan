/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

var assert = require('assert-plus');
var mod_client = require('./client');
var mod_common = require('../../lib/common');
var mod_types = require('../../lib/types');



// --- Globals



var STATUS = mod_types.svp_status;



// --- Exports



/**
 * Make a ping request
 */
function reqPing(t) {
    mod_client.get(function (_, client) {
        client.ping(function _afterPing(err, res) {
            t.ifErr(err, 'ping error');
            if (err) {
                return t.end();
            }

            t.deepEqual(res, { status: 'ok' }, 'ping res');
            return t.end();
        });
    });
}


/**
 * Make a VL2 request
 */
function reqVL2(t, opts) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.object(opts.exp, 'opts.exp');
    assert.object(opts.params, 'opts.params');

    mod_client.get(function (_, client) {
        client.vl2Req(opts.params, function _afterVL2(err, res) {
            t.ifErr(err, 'vl2 error');
            if (err) {
                return t.end();
            }

            t.deepEqual(res, opts.exp, 'vl2 res');
            return t.end();
        });
    });
}


/**
 * Make a VL3 request
 */
function reqVL3(t, opts) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.object(opts.exp, 'opts.exp');
    assert.object(opts.params, 'opts.params');

    mod_client.get(function (_, client) {
        var params = {
            ip: mod_common.IPv6obj(opts.params.ip),
            vnet_id: opts.params.vnet_id
        };

        client.vl3Req(params, function _afterVL3(err, res) {
            t.ifErr(err, 'vl3 error');
            if (err) {
                return t.end();
            }

            t.deepEqual(res, opts.exp, 'vl3 res');
            return t.end();
        });
    });
}


/**
 * Returns a client response for VL2 mapping not found
 */
function vl2NotFound() {
    return {
        status: STATUS.SVP_S_NOTFOUND,
        status_str: mod_types.statusString(STATUS.SVP_S_NOTFOUND),
        vl2_ip: '::',
        vl2_port: 0
    };
}


/**
 * Returns a client response for VL3 mapping not found
 */
function vl3NotFound() {
    return {
        status: STATUS.SVP_S_NOTFOUND,
        status_str: mod_types.statusString(STATUS.SVP_S_NOTFOUND),
        vl3_mac: '00:00:00:00:00:00',
        vl3_ip: '::',
        vl3_port: 0
    };
}



module.exports = {
    ping: reqPing,
    vl2: reqVL2,
    vl2NotFound: vl2NotFound,
    vl3: reqVL3,
    vl3NotFound: vl3NotFound
};
