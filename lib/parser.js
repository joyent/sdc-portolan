/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * SDC VXLAN Protocol parser
 */

var ipaddr = require('ipaddr.js');
var stream = require('stream');
var types = require('./types');
var util = require('util');



// --- Internal



/**
 * Convert an array to a MAC address string
 */
function macArrToString(mac) {
    return mac.map(function (m) {
        var n = m.toString(16);
        if (n.length == 1) {
            return '0' + n;
        }

        return n;
    }).join(':');
}


/**
 * Create an IPv6 address object given an array of 16 bytes
 */
function ipFromArr(arr) {
    return new ipaddr.IPv6([
        (arr[0] << 8) | arr [1],
        (arr[2] << 8) | arr [3],
        (arr[4] << 8) | arr [5],
        (arr[6] << 8) | arr [7],
        (arr[8] << 8) | arr [9],
        (arr[10] << 8) | arr [11],
        (arr[12] << 8) | arr [13],
        (arr[14] << 8) | arr [15]
    ]);
}



// --- Exports



/**
 * SDC VLAN Protocol parser object
 */
function SVPparser(opts) {
    this.log = opts.log.child({ component: 'parser' });
    opts.objectMode = true;

    if (!this instanceof SVPparser) {
        return new SVPparser(opts);
    }

    stream.Transform.call(this, opts);
}

util.inherits(SVPparser, stream.Transform);


SVPparser.prototype._transform = function _svpTransform(buf, enc, callback) {
    if (buf.length < types.sizeof.SVP_REQ) {
        this.log.debug({ len: buf.length }, 'buffer too short');
        return;
    }

    var req = types.parser.readData([ { hdr: { type: 'svp_req_t' } } ], buf, 0);

    if (!types.svp_op_names.hasOwnProperty(req.hdr.svp_op)) {
        this.log.warn({ op: req.hdr.svp_op }, 'unknown svp_op');
        return;
    }

    var op = req.hdr.svp_op;
    var opInfo = types.opInfo(op);

    if (!opInfo.type) {
        // We don't have a way of formulating a response yet
        this.log.warn({ hdr: req.hdr }, 'unsupported svp_op');
        return;
    }

    this.log.debug({ hdr: req.hdr }, 'message header');

    if (buf.length < opInfo.sizeofReq) {
        this.log.warn({ len: buf.length, sizeof: opInfo.sizeofReq, op: op },
            'buffer too short');
        return;
    }

    var payload = types.parser.readData([ { body: { type: opInfo.type } } ],
        buf, types.sizeof.SVP_REQ);

    this.log.debug({ body: payload.body }, 'message body');

    var rec = {
        svp_type: req.hdr.svp_op,
        svp_id: req.hdr.svp_id,
        svp_msg: { }
    };

    switch (req.hdr.svp_op) {
        case types.svp_op.SVP_R_VL2_REQ:
            rec.svp_msg = {
                vl2_mac: macArrToString(payload.body.sl2r_mac),
                vl2_vnet_id: payload.body.sl2r_vnetid
            };
            break;
        case types.svp_op.SVP_R_VL3_REQ:
            // XXX: return error if sl3r_type is not 1 or 2
            var ip = ipFromArr(payload.body.sl3r_ip);
            rec.svp_msg = {
                vl3_ip: ip,
                vl3_vnet_id: payload.body.sl3r_vnetid
            };
            break;
        default:
            this.log.warn({ message: msg }, 'unknown message svp_op');
            return;
            break;
    }

    this.push(rec);
    return callback();
};



module.exports = SVPparser;
