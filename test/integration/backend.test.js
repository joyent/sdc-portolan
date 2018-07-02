/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

'use strict';

var mod_common = require('../../lib/common');
var mod_mapping = require('../lib/mapping');
var mod_req = require('../lib/request');
var mod_server = require('../lib/server');
var mod_moray = require('../../lib/backend/moray');
var mod_types = require('../../lib/types');
var mod_uuid = require('node-uuid');
var mod_log = require('../lib/log');
var clone = require('clone');
var test = require('tape');



// --- Globals



var CNS = [
    {
        cn_uuid: 'b4e5ff64-7b40-11e4-a6fa-d34c824a42cd',
        ip: '192.168.1.1',
        port: 123
    },
    {
        cn_uuid: '356cee1f-c4d2-46a8-98e9-2361875a6aa4',
        ip: '192.168.1.2',
        port: 123
    }
];

var VMS = [
    {
        mac: '00:0a:95:9d:68:16',
        ip: '10.0.0.1',
        cn_uuid: CNS[0].cn_uuid,
        vnet_id: 12340,
        deleted: false
    },

    // VM mapping exists, but not the underlying CN mapping:
    {
        mac: '00:0a:95:11:11:11',
        ip: '10.0.0.2',
        cn_uuid: mod_uuid.v4(),
        vnet_id: 12340,
        deleted: false
    }
];

var ROUTES = [
    {
        net_uuid: '8ae421cb-7190-4c49-a1cf-2d61ef0b87b8',
        vnet_id: 11111,
        vlan_id: 1,
        subnet: '192.168.111.0/24',
        r_dc_id: 22,
        r_net_uuid: 'c228f359-d387-48c0-8d6b-b0be46193622',
        r_vnet_id: 22222,
        r_vlan_id: 2,
        r_subnet: '192.168.222.0/24',
        r_send_mac: '00:0a:95:ff:ff:ff'
    },
    {
        net_uuid: '911dd15b-7fe1-479a-ae41-4fd5f83a0beb',
        vnet_id: 101010,
        vlan_id: 10,
        subnet: '192.168.100.0/24',
        r_dc_id: 0,
        r_net_uuid: 'dd2ca4f2-b501-4d90-9a63-db437c14c73b',
        r_vnet_id: 12340, // same as VMS[0]
        r_vlan_id: 20,
        r_subnet: '10.0.0.0/24', // same as VMS[0]
        r_send_mac: '00:0a:59:ff:ff:ff'
    }

];


var ROUTE_IPS = [
    {
        src: '192.168.111.1',
        dst: '192.168.222.1'
    },
    {
        src: '192.168.100.1',
        dst: VMS[0].ip // same as VMS[0]
    }
];

var VL2EVENTS = [
    {
        vnetCns: CNS.map(function (c) { return c.cn_uuid; }),
        vnet_id: 99999,
        mac: '00:0a:99:ff:ff:ff'
    }
];

var VL3EVENTS = [
    {
        vnetCns: CNS.map(function (c) { return c.cn_uuid; }),
        vnet_id: 88888,
        mac: '00:0a:88:ff:ff:ff',
        vlan_id: 8,
        ip: '88.88.88.88'
    }
];

var ROUTE_EVENTS = [
    {
        vnetCns: CNS.map(function (c) { return c.cn_uuid; }),
        src_vnet_id: 11111,
        dst_vnet_id: 22222,
        dcid: 2,
        srcip: '11.11.11.11',
        dstip: '22.22.22.22',
        src_vlan_id: 1,
        dst_vlan_id: 2,
        src_prefixlen: 24,
        dst_prefixlen: 24
    }
];

var STATUS = mod_types.svp_status;



// --- Tests



test('setup', function (t) {
    t.test('start server', mod_server.start);

    t.test('add underlay mapping 0', function (t2) {
        mod_mapping.addUnderlay(t2, {
            params: CNS[0]
        });
    });

    t.test('add underlay mapping 1', function (t2) {
        mod_mapping.addUnderlay(t2, {
            params: CNS[1]
        });
    });

    t.test('add overlay mapping: VM 0', function (t2) {
        mod_mapping.addOverlay(t2, {
            params: VMS[0]
        });
    });


    t.test('add overlay mapping: VM 1', function (t2) {
        mod_mapping.addOverlay(t2, {
            params: VMS[1]
        });
    });

    t.test('add vnet route mapping 0', function (t2) {
        mod_mapping.addVnetRoute(t2, {
            params: ROUTES[0]
        });
    });

    t.test('add vnet route mapping 1', function (t2) {
        mod_mapping.addVnetRoute(t2, {
            params: ROUTES[1]
        });
    });

    t.test('add vl2 event mapping 0', function (t2) {
        mod_mapping.addEventMapping(t2, {
            type: 'SVP_LOG_VL2',
            params: VL2EVENTS[0]
        });
    });

    t.test('add vl3 event mapping 0', function (t2) {
        mod_mapping.addEventMapping(t2, {
            type: 'SVP_LOG_VL3',
            params: VL3EVENTS[0]
        });
    });

    t.test('add route event mapping 0', function (t2) {
        mod_mapping.addEventMapping(t2, {
            type: 'SVP_LOG_ROUTE',
            params: ROUTE_EVENTS[0]
        });
    });
});


test('ping', function (t) {
    mod_req.ping(t);
});

test('vl2', function (t) {

    t.test('mapping exists', function (t2) {
        mod_req.vl2(t2, {
            params: {
                mac: VMS[0].mac,
                vnet_id: VMS[0].vnet_id
            },
            exp: {
                status: STATUS.SVP_S_OK,
                status_str: mod_types.statusString(STATUS.SVP_S_OK),
                vl2_ip: mod_common.ipv4StrTov6(CNS[0].ip),
                vl2_port: CNS[0].port
            }
        });
    });


    t.test('vnet_id exists, but not mac', function (t2) {
        mod_req.vl2(t2, {
            params: {
                mac: '00:00:99:99:88:11',
                vnet_id: VMS[0].vnet_id
            },
            exp: mod_req.vl2NotFound()
        });
    });


    t.test('mac exists, but not vnet_id', function (t2) {
        mod_req.vl2(t2, {
            params: {
                mac: VMS[0].mac,
                vnet_id: VMS[0].vnet_id + 1
            },
            exp: mod_req.vl2NotFound()
        });
    });


    t.test('overlay mapping exists, but not underlay', function (t2) {
        mod_req.vl2(t2, {
            params: {
                mac: VMS[1].mac,
                vnet_id: VMS[1].vnet_id
            },
            exp: mod_req.vl2NotFound()
        });
    });

});


test('vl3', function (t) {
    t.test('mapping exists', function (t2) {
        mod_req.vl3(t2, {
            params: {
                ip: VMS[0].ip,
                vnet_id: VMS[0].vnet_id
            },
            exp: {
                status: STATUS.SVP_S_OK,
                status_str: mod_types.statusString(STATUS.SVP_S_OK),
                vl3_ip: mod_common.ipv4StrTov6(CNS[0].ip),
                vl3_mac: VMS[0].mac,
                vl3_port: CNS[0].port
            }
        });
    });


    t.test('vnet_id exists, but not IP', function (t2) {
        mod_req.vl3(t2, {
            params: {
                ip: '10.0.0.2',
                vnet_id: VMS[0].vnet_id
            },
            exp: mod_req.vl3NotFound()
        });
    });


    t.test('IP exists, but not vnet_id', function (t2) {
        mod_req.vl3(t2, {
            params: {
                ip: VMS[0].ip,
                vnet_id: VMS[0].vnet_id + 1
            },
            exp: mod_req.vl3NotFound()
        });
    });


    t.test('overlay mapping exists, but not underlay', function (t2) {
        mod_req.vl3(t2, {
            params: {
                ip: VMS[1].ip,
                vnet_id: VMS[1].vnet_id
            },
            exp: mod_req.vl3NotFound()
        });
    });

});

test('vnetRoute', function (t) {
    t.test('vnet and vl3 mapping exists', function (t2) {
        mod_req.vnetRoute(t2, {
            params: {
                vnet_id: ROUTES[1].vnet_id,
                vlan_id: ROUTES[1].vlan_id,
                srcip: ROUTE_IPS[1].src,
                dstip: ROUTE_IPS[1].dst
            },
            exp: {
                status: STATUS.SVP_S_OK,
                status_str: mod_types.statusString(STATUS.SVP_S_OK),
                r_dc_id: ROUTES[1].r_dc_id,
                r_vnet_id: ROUTES[1].r_vnet_id,
                r_vlan_id: ROUTES[1].r_vlan_id,
                prefixlen: parseInt(ROUTES[1].subnet.split('/')[1], 10),
                r_prefixlen: parseInt(ROUTES[1].r_subnet.split('/')[1], 10),
                r_port: CNS[0].port,
                r_ul3_ip: mod_common.ipv4StrTov6(CNS[0].ip),
                vl2_src_mac: ROUTES[1].r_send_mac,
                vl2_dst_mac: VMS[0].mac
            }
        });
    });

    t.test('wrong vnet and vlan', function (t2) {
        mod_req.vnetRoute(t2, {
            params: {
                vnet_id: 1111111111,
                vlan_id: 9999,
                srcip: ROUTE_IPS[1].src,
                dstip: ROUTE_IPS[1].dst
            },
            exp: mod_req.vnetRouteNotFound()
        });
    });

    t.test('wrong source ip/subnet', function (t2) {
        mod_req.vnetRoute(t2, {
            params: {
                vnet_id: ROUTES[1].vnet_id,
                vlan_id: ROUTES[1].vlan_id,
                srcip: '10.10.10.10',
                dstip: ROUTE_IPS[1].dst
            },
            exp: mod_req.vnetRouteNotFound()
        });
    });

    t.test('correct source ip/subnet, w/o matching vl3 mapping', function (t2) {
        mod_req.vnetRoute(t2, {
            params: {
                vnet_id: ROUTES[0].vnet_id,
                vlan_id: ROUTES[0].vlan_id,
                srcip: ROUTE_IPS[0].src,
                dstip: ROUTE_IPS[0].dst
            },
            exp: mod_req.vnetRouteNotFound()
        });
    });
});

test('svp_log', function (t) {

    t.test('svp_log_req', function (t2) {
        mod_req.vlogs(t2, {
            params: {
                ip: CNS[1].ip,
                count: mod_types.sizeof.SVP_LOG_ROUTE +
                    mod_types.sizeof.SVP_LOG_VL3 +
                    mod_types.sizeof.SVP_LOG_VL2
            },
            exp: {
                la_data:
                    [ {
                        mac: VL2EVENTS[0].mac,
                        type: 'SVP_LOG_VL2',
                        vnet_id: VL2EVENTS[0].vnet_id
                    }, {
                        ip: mod_common.ipv4StrTov6(VL3EVENTS[0].ip),
                        type: 'SVP_LOG_VL3',
                        vlan: VL3EVENTS[0].vlan_id,
                        vnet_id: VL3EVENTS[0].vnet_id
                    }, {
                        dcid: ROUTE_EVENTS[0].dcid,
                        dst_vlan: ROUTE_EVENTS[0].dst_vlan_id,
                        dst_vnet_id: ROUTE_EVENTS[0].dst_vnet_id,
                        srcip: mod_common.ipv4StrTov6(ROUTE_EVENTS[0].srcip),
                        dstip: mod_common.ipv4StrTov6(ROUTE_EVENTS[0].dstip),
                        src_prefixlen: ROUTE_EVENTS[0].src_prefixlen,
                        dst_prefixlen: ROUTE_EVENTS[0].dst_prefixlen,
                        src_vlan: ROUTE_EVENTS[0].src_vlan_id,
                        src_vnet_id: ROUTE_EVENTS[0].src_vnet_id,
                        type: 'SVP_LOG_ROUTE'
                    } ],
                status: 0,
                status_str: 'SVP_S_OK'
            }
        });
    });

    t.test('svp_log_VL2_req low count', function (t2) {
        mod_req.vlogs(t2, {
            params: {
                ip: CNS[1].ip,
                count: 3
            },
            exp: { la_data: [], status: 0, status_str: 'SVP_S_OK' }
        });
    });
});

/*
 * This is a bit backhanded since portolan doesn't actually use this method.
 * This test should probably be implemented in NAPI.  Either that or we could
 * expose this a a test for the portolan cli tool.
 */
test('vnetRouteList', function (t) {
    var log = mod_log.child({ component: 'vnetRouteTest' });
    t.test('vnetRouteList correct', function (t2) {
        mod_moray.listVnetRouteMappings({
            log: log,
            net_uuid: ROUTES[1].net_uuid
        }, function (err, nets) {
            t2.ifErr(err, 'vnetRouteList Error');
            if (err) {
                return t2.end();
            }

            var exp = clone(ROUTES[1]);
            exp.deleted = false;
            exp.version = 1;
            exp.r_send_mac = mod_common.macToInt(ROUTES[1].r_send_mac);
            exp.r_subnet = mod_common.cidrv4StrTov6(ROUTES[1].r_subnet);
            exp.subnet = mod_common.cidrv4StrTov6(ROUTES[1].subnet);

            t2.deepEqual(nets, Array(exp));

            return t2.end();
        });
    });

    t.test('vnetRouteList empty', function (t2) {
        mod_moray.listVnetRouteMappings({
            log: log,
            net_uuid: '00000000-0000-0000-0000-000000000000'
        }, function (err, nets) {
            t2.ifErr(err, 'vnetRouteList Error');
            if (err) {
                return t2.end();
            }

            t2.deepEqual(nets, []);

            return t2.end();
        });
    });
});

// TODO: remove other mappings
test('remove mappings', function (t) {
    t.test('remove vnet route mapping 0', function (t2) {
        mod_mapping.removeVnetRoute(t2, {
            params: ROUTES[0]
        });
    });

    t.test('remove vnet route mapping 1', function (t2) {
        mod_mapping.removeVnetRoute(t2, {
            params: ROUTES[1]
        });
    });
});

// TODO:
// log lookup tests:
// - try to delete a record that doesn't exist
// - double-delete a record
// version mismatch
// malformed request handling

test('teardown', function (t) {
    t.test('stop server', function (t2) {
        mod_server.stop(t2);
    });
});
