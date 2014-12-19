/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Portolan struct defininitions for the SDC VXLAN Protocol
 */

var ctype = require('ctype');
var fs = require('fs');
var path = require('path');
var util = require('util');



var VXLAN_PORT = 4789;
var SVP_VER = 1;

var op_types = {
    3: 'svp_vl2_req_t',
    4: 'svp_vl2_ack_t',
    5: 'svp_vl3_req_t',
    6: 'svp_vl3_ack_t'
};

var sizeof = {
    SVP_R_PING: 0,
    SVP_R_PONG: 0,
    SVP_REQ: 16,
    SVP_VL2_REQ: 12,
    SVP_VL2_ACK: 20,
    SVP_R_VL2_REQ: 12,
    SVP_R_VL3_REQ: 24,
    SVP_R_VL3_ACK: 28
};

var sizeof_ops = {
    1: sizeof.SVP_R_PING,
    2: sizeof.SVP_R_PONG,
    3: sizeof.SVP_R_VL2_REQ,
    4: sizeof.SVP_VL2_ACK,
    5: sizeof.SVP_R_VL3_REQ,
    6: sizeof.SVP_R_VL3_ACK
};

var svp_op = {
    // 'SVP_R_UNKNOWN': 0
    // ...
};

var svp_op_names = {
    // 0: 'SVP_R_UNKNOWN'
    // ...
};

var svp_op_hex = {
    SVP_R_UNKNOWN: '0x00',
    SVP_R_PING: '0x01',
    SVP_R_PONG: '0x02',
    SVP_R_VL2_REQ: '0x03',
    SVP_R_VL2_ACK: '0x04',
    SVP_R_VL3_REQ: '0x05',
    SVP_R_VL3_ACK: '0x06',
    SVP_R_BULK_REQ: '0x07',
    SVP_R_BULK_ACK: '0x08',
    SVP_R_LOG_REQ: '0x09',
    SVP_R_LOG_ACK: '0x0A',
    SVP_R_LOG_RM: '0x0B',
    SVP_R_LOG_RACK: '0x0C',
    SVP_R_SHOOTDOWN: '0x0D'
};

var svp_status = {
    SVP_S_OK: 0,        /* Everything OK */
    SVP_S_FATAL: 1,     /* Fatal error, close connection */
    SVP_S_NOTFOUND: 2,  /* Entry not found */
    SVP_S_BADL3TYPE: 3, /* Unknown svp_vl3_type_t */
    SVP_S_BADBULK: 4,   /* Unknown svp_bulk_type_t */
    SVP_S_BADLOG: 5,    /* Unknown svp_log_type_t */
    SVP_S_LOGAGIN: 6    /* Nothing in the log yet */
};

var svp_status_names = {
    // 0: 'SVP_S_OK'
    // ...
};

var svp_vl3_type = {
    SVP_VL3_IP: 1,
    SVP_VL3_IPV6: 2
};

var types = JSON.parse(fs.readFileSync(
        path.normalize(__dirname + '/../etc/svp-types.json', 'utf8')));
var parser = new ctype.parseCTF(types, { endian: 'big' });

for (var e in svp_op_hex) {
    var intVal = parseInt(svp_op_hex[e], 16);
    svp_op[e] = intVal;
    svp_op_names[intVal] = e;
}

for (var s in svp_status) {
    svp_status_names[svp_status[s]] = s;
}

// console.log(JSON.stringify(parser.lstypes(), null, 2));


function opInfo(op) {
    return {
        name: svp_op_names[op],
        sizeof: sizeof_ops[op],
        sizeofReq: sizeof.SVP_REQ + sizeof_ops[op],
        type: op_types[op] || null
    };
}

function statusString(op) {
    return svp_status_names[op] || '<unknown>';
}


module.exports = {
    opInfo: opInfo,
    parser: parser,
    sizeof: sizeof,
    sizeof_ops: sizeof_ops,
    statusString: statusString,
    svp_op: svp_op,
    svp_op_names: svp_op_names,
    svp_status: svp_status,
    svp_vl3_type: svp_vl3_type,
    version: SVP_VER,
    VXLAN_PORT: VXLAN_PORT
};
