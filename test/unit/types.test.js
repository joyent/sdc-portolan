/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * Tests to make sure all of the basic info for all of the types are defined
 * correctly. This is paranoia-driven, to make sure someone notices if these
 * values are changed accidentally.
 */

'use strict';

var mod_types = require('../../lib/types');
var test = require('tape');

var req_size = mod_types.sizeof.SVP_REQ;
var svp_op = mod_types.svp_op;



// --- Tests



test('opinfo', function (t) {
    var types = [
        {
            name: 'SVP_R_PING',
            op: svp_op.SVP_R_PING,
            sizeof: 0,
            type: null
        },
        {
            name: 'SVP_R_PONG',
            op: svp_op.SVP_R_PONG,
            sizeof: 0,
            type: null
        },
        {
            name: 'SVP_R_VL2_REQ',
            op: svp_op.SVP_R_VL2_REQ,
            sizeof: 12,
            type: 'svp_vl2_req_t'
        },
        {
            name: 'SVP_R_VL2_ACK',
            op: svp_op.SVP_R_VL2_ACK,
            sizeof: 20,
            type: 'svp_vl2_ack_t'
        },
        {
            name: 'SVP_R_VL3_REQ',
            op: svp_op.SVP_R_VL3_REQ,
            sizeof: 24,
            type: 'svp_vl3_req_t'
        },
        {
            name: 'SVP_R_VL3_ACK',
            op: svp_op.SVP_R_VL3_ACK,
            sizeof: 28,
            type: 'svp_vl3_ack_t'
        },
        {
            name: 'SVP_R_LOG_REQ',
            op: svp_op.SVP_R_LOG_REQ,
            sizeof: 20,
            type: 'svp_log_req_t'
        },
        {
            name: 'SVP_R_LOG_ACK',
            op: svp_op.SVP_R_LOG_ACK,
            sizeof: 4,
            type: 'svp_log_ack_t'
        },
        {
            name: 'SVP_R_LOG_RM',
            op: svp_op.SVP_R_LOG_RM,
            sizeof: 4,
            type: 'svp_lrm_req_t'
        },
        {
            name: 'SVP_R_LOG_RM_ACK',
            op: svp_op.SVP_R_LOG_RM_ACK,
            sizeof: 4,
            type: 'svp_lrm_ack_t'
        },
        {
            name: 'SVP_R_SHOOTDOWN',
            op: svp_op.SVP_R_SHOOTDOWN,
            sizeof: 12,
            type: 'svp_shootdown_t'
        },
        {
            name: 'SVP_R_ROUTE_REQ',
            op: svp_op.SVP_R_ROUTE_REQ,
            sizeof: 40,
            type: 'svp_route_req_t'
        },
        {
            name: 'SVP_R_ROUTE_ACK',
            op: svp_op.SVP_R_ROUTE_ACK,
            sizeof: 48,
            type: 'svp_route_ack_t'
        }
    ];

    for (var ty in types) {
        var type = types[ty];
        // Just making sure we fail if things are added / removed:
        t.ok(type.op !== null, 'op');
        t.equal(Object.keys(type).length, 4, 'keys');

        var opinfo = mod_types.opInfo(type.op);

        t.equal(opinfo.name, type.name, type.name + ' name');
        t.equal(opinfo.sizeof, type.sizeof, 'sizeof');
        t.equal(opinfo.sizeofReq, type.sizeof + req_size, 'sizeofReq');
        t.equal(opinfo.type, type.type, 'type');
    }

    t.end();
});
