/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

var mod_common = require('../../lib/common');
var mod_mapping = require('../lib/mapping');
var mod_req = require('../lib/request');
var mod_server = require('../lib/server');
var mod_types = require('../../lib/types');
var mod_uuid = require('node-uuid');
var test = require('tape');



// --- Globals



var CNS = [
    {
        cn_uuid: 'b4e5ff64-7b40-11e4-a6fa-d34c824a42cd',
        ip: '192.168.1.1',
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

var STATUS = mod_types.svp_status;



// --- Tests



test('setup', function (t) {
    t.test('start server', mod_server.start);

    t.test('add underlay mapping', function (t2) {
        mod_mapping.addUnderlay(t2, {
            params: CNS[0]
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


// XXX: log lookup tests:
// - try to delete a record that doesn't exist
// - double-delete a record



// XXX: remove mappings


test('teardown', mod_server.stop);
