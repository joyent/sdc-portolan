/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

'use strict';

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
 * Make a vnetroute request
 */
function reqVnetRoute(t, opts) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.object(opts.exp, 'opts.exp');
    assert.object(opts.params, 'opts.params');
    assert.number(opts.params.vnet_id, 'opts.params.vnet_id');
    assert.number(opts.params.vlan_id, 'opts.params.vlan_id');
    assert.string(opts.params.srcip, 'opts.params.srcip');
    assert.string(opts.params.dstip, 'opts.params.dstip');

    mod_client.get(function (_, client) {
        var params = {
            vnet_id: opts.params.vnet_id,
            vlan_id: opts.params.vlan_id,
            srcip: mod_common.IPv6obj(opts.params.srcip),
            dstip: mod_common.IPv6obj(opts.params.dstip)
        };

        client.vnetRouteReq(params, function _aftervnetRoute(err, res) {
            t.ifErr(err, 'vnetRoute error');
            if (err) {
                return t.end();
            }

            if (Object.keys(res).length === 0) {
                res = vnetRouteNotFound();
            }

            t.deepEqual(res, opts.exp, 'vnetRoute res');
            return t.end();
        });
    });
}

function reqVlogs(t, opts) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.object(opts.exp, 'opts.exp');
    assert.object(opts.params, 'opts.params');
    assert.string(opts.params.ip, 'opts.params.ip');
    assert.number(opts.params.count, 'opts.params.count');

    mod_client.get(function (_, client) {
        var params = {
            ip: mod_common.IPv6obj(opts.params.ip),
            count: opts.params.count
        };

        client.logReq(params, function _afterlogReq(err, res) {
            t.ifErr(err, 'logReq error');
            if (err) {
                return t.end();
            }

            /*
             * Log record id's are created dynamically.  For now just test that
             * they exist and are of the right type.  Then delete them and do a
             * deep equal with the other fields.
             */
            for (var i = 0; i < res.la_data.length; i++) {
                var record = res.la_data[i];
                t.assert(record.id && typeof (record.id) === 'string' &&
                    record.id.length > 0, 'record id');
                delete res.la_data[i].id;
            }

            t.deepEqual(res, opts.exp, 'logReq res');
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

function vnetRouteNotFound() {
    return {
        status: STATUS.SVP_S_NOTFOUND,
        status_str: mod_types.statusString(STATUS.SVP_S_NOTFOUND),
        prefixlen: 0,
        r_dc_id: 0,
        r_port: 0,
        r_prefixlen: 0,
        r_ul3_ip: '::',
        r_vlan_id: 0,
        r_vnet_id: 0,
        vl2_dst_mac: '00:00:00:00:00:00',
        vl2_src_mac: '00:00:00:00:00:00'
    };
}

module.exports = {
    ping: reqPing,
    vl2: reqVL2,
    vl2NotFound: vl2NotFound,
    vl3: reqVL3,
    vl3NotFound: vl3NotFound,
    vlogs: reqVlogs,
    vnetRoute: reqVnetRoute,
    vnetRouteNotFound: vnetRouteNotFound
};
