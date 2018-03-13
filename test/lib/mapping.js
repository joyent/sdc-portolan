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
var mod_common = require('../../lib/common.js');
var mod_moray = require('../../lib/backend/moray');
var types = require('../../lib/types.js');
var clone = require('clone');



// --- Exports



function addOverlayMapping(t, opts) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.object(opts.params, 'opts.params');
    assert.string(opts.params.cn_uuid, 'opts.params.cn_uuid');
    assert.optionalBool(opts.params.deleted, 'opts.params.deleted');
    assert.string(opts.params.ip, 'opts.params.ip');
    assert.string(opts.params.mac, 'opts.params.mac');
    assert.number(opts.params.vnet_id, 'opts.params.vnet_id');

    var val = {
        cn_uuid: opts.params.cn_uuid,
        ip: mod_common.IPv6obj(opts.params.ip),
        mac: mod_common.macToInt(opts.params.mac),
        vnet_id: opts.params.vnet_id,
        deleted: opts.params.deleted || false
    };

    mod_moray.addOverlayMapping(val, function _afterUnderlay(err) {
        t.ifErr(err, 'add overlay mapping');
        return t.end();
    });
}


function addUnderlayMapping(t, opts) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.object(opts.params, 'opts.params');
    assert.string(opts.params.cn_uuid, 'opts.params.cn_uuid');
    assert.string(opts.params.ip, 'opts.params.ip');
    assert.number(opts.params.port, 'opts.params.port');

    var val = {
        cn_uuid: opts.params.cn_uuid,
        ip: mod_common.IPv6obj(opts.params.ip),
        port: opts.params.port
    };

    mod_moray.addUnderlayMapping(val, function _afterUnderlay(err) {
        t.ifErr(err, 'add underlay mapping');
        return t.end();
    });
}


function addEventMapping(t, opts) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.string(opts.type, 'opts.type');
    assert.object(opts.params, 'opts.params');
    assert.arrayOfString(opts.params.vnetCns, 'opts.params.vnetCns');

    var func;
    var val = clone(opts.params);
    var logType = types.svp_log_type[opts.type];

    switch (logType) {
    case types.svp_log_type.SVP_LOG_VL2:
        assert.string(opts.params.mac, 'opts.params.mac');
        assert.number(opts.params.vnet_id, 'opts.params.vnet_id');

        val.mac = mod_common.macToInt(opts.params.mac);
        func = 'addVl2CnEventBatch';

        break;
    case types.svp_log_type.SVP_LOG_VL3:
        assert.string(opts.params.ip, 'opts.params.ip');
        assert.number(opts.params.vlan_id, 'opts.params.vlan');
        assert.string(opts.params.mac, 'opts.params.mac');
        assert.number(opts.params.vnet_id, 'opts.params.vnet_id');

        val.mac = mod_common.macToInt(opts.params.mac);
        val.ip = mod_common.IPv6obj(opts.params.ip);
        func = 'addVl3CnEventBatch';

        break;
    case types.svp_log_type.SVP_LOG_ROUTE:
        assert.number(opts.params.src_vnet_id, 'opts.params.src_vnet_id');
        assert.number(opts.params.dst_vnet_id, 'opts.params.dst_vnet_id');
        assert.number(opts.params.dcid, 'opts.params.dcid');
        assert.string(opts.params.srcip, 'opts.params.srcip');
        assert.string(opts.params.dstip, 'opts.params.dstip');
        assert.number(opts.params.src_vlan_id, 'opts.params.src_vlan_id');
        assert.number(opts.params.dst_vlan_id, 'opts.params.src_vlan_id');
        assert.number(opts.params.src_prefixlen, 'opts.params.src_prefixlen');
        assert.number(opts.params.dst_prefixlen, 'opts.params.dst_prefixlen');

        val.srcip = mod_common.IPv6obj(opts.params.srcip);
        val.dstip = mod_common.IPv6obj(opts.params.dstip);
        func = 'addVnetRouteCnEventBatch';

        break;
    default:
        t.notok('unknown svp_log_type', opts.type);
        t.end();
        return;
    }

    mod_moray[func](val, function _afterEventBatch(err) {
        t.ifErr(err, 'add Event Mapping');
        t.end();
        return;
    });
}

function addVnetRouteMapping(t, opts) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.object(opts.params, 'opts.params');
    assert.number(opts.params.vnet_id, 'opts.params.vnet_id');
    assert.number(opts.params.vlan_id, 'opts.params.vlan_id');
    assert.string(opts.params.subnet, 'opts.params.subnet');
    assert.number(opts.params.r_dc_id, 'opts.params.r_dc_id');
    assert.number(opts.params.r_vnet_id, 'opts.params.r_vnet_id');
    assert.number(opts.params.r_vlan_id, 'opts.params.r_vlan_id');
    assert.string(opts.params.r_subnet, 'opts.params.r_subnet');
    assert.string(opts.params.r_send_mac, 'opts.params.r_send_mac');

    var val = {
        net_uuid: opts.params.net_uuid,
        vnet_id: opts.params.vnet_id,
        vlan_id: opts.params.vlan_id,
        subnet: mod_common.IPv6SubObj(opts.params.subnet),
        r_dc_id: opts.params.r_dc_id,
        r_net_uuid: opts.params.r_net_uuid,
        r_vnet_id: opts.params.r_vnet_id,
        r_vlan_id: opts.params.r_vlan_id,
        r_subnet: mod_common.IPv6SubObj(opts.params.r_subnet),
        r_send_mac: mod_common.macToInt(opts.params.r_send_mac)
    };

    mod_moray.addVnetRouteMapping(val, function _afterVnetRoute(err) {
        t.ifErr(err, 'add vnet route mapping');
        t.end();
        return;
    });
}

function removeVnetRouteMapping(t, opts) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.object(opts.params, 'opts.params');
    assert.number(opts.params.vnet_id, 'opts.params.vnet_id');
    assert.number(opts.params.vlan_id, 'opts.params.vlan_id');
    assert.string(opts.params.subnet, 'opts.params.subnet');
    assert.string(opts.params.r_subnet, 'opts.params.r_subnet');

    var val = {
        vnet_id: opts.params.vnet_id,
        vlan_id: opts.params.vlan_id,
        subnet: mod_common.IPv6SubObj(opts.params.subnet),
        r_subnet: mod_common.IPv6SubObj(opts.params.r_subnet)
    };

    mod_moray.removeVnetRouteMapping(val, function _afterVnetRoute(err) {
        t.ifErr(err, 'remove vnet route mapping');
        t.end();
        return;
    });
}


module.exports = {
    addOverlay: addOverlayMapping,
    addUnderlay: addUnderlayMapping,
    addVnetRoute: addVnetRouteMapping,
    removeVnetRoute: removeVnetRouteMapping,
    addEventMapping: addEventMapping
};
