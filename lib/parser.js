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

var common = require('./common');
var ipaddr = require('ipaddr.js');
var stream = require('stream');
var types = require('./types');
var util = require('util');
var mod_crc = require('./crc32.js');



// --- Internal



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


SVPparser.prototype._transform =
    function _svpParseTransform(buf, enc, callback) {
    if (buf.length < types.sizeof.SVP_REQ) {
        this.log.debug({ len: buf.length }, 'buffer too short');
        return;
    }

    var crc32;
    var payload;
    var req = types.parser.readData([ { hdr: { type: 'svp_req_t' } } ], buf, 0);
    var op = req.hdr.svp_op;
    var opInfo = types.opInfo(op);

    if (opInfo.type === undefined) {
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

    if (opInfo.type) {
        payload = types.parser.readData([ { body: { type: opInfo.type } } ],
            buf, types.sizeof.SVP_REQ);
        this.log.debug({ body: payload.body }, 'message body');
    }

    var rec = {
        svp_type: req.hdr.svp_op,
        svp_id: req.hdr.svp_id,
        svp_msg: { }
    };

    switch (req.hdr.svp_op) {
        case types.svp_op.SVP_R_PING:
            // No value: just return the header
            break;

        case types.svp_op.SVP_R_PONG:
            // No value: just return the header
            break;

        case types.svp_op.SVP_R_VL2_ACK:
            rec.svp_msg = {
                vl2_status: payload.body.sl2a_status,
                vl2_port: payload.body.sl2a_port,
                vl2_ip: ipFromArr(payload.body.sl2a_addr)
            };
            break;

        case types.svp_op.SVP_R_VL2_REQ:
            rec.svp_msg = {
                vl2_mac: common.macArrToInt(payload.body.sl2r_mac),
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

        case types.svp_op.SVP_R_VL3_ACK:
            rec.svp_msg = {
                vl3_status: payload.body.sl3a_status,
                vl3_mac: common.macArrToInt(payload.body.sl3a_mac),
                vl3_port: payload.body.sl3a_port,
                vl3_ip: ipFromArr(payload.body.sl3a_uip)
            };
            break;

        default:
            this.log.warn({ hdr: req.hdr, body: payload.body },
                'unknown message svp_op');
            return;
    }

    /*
     * Check the CRC, to do this, we have to first zero the original buffer's
     * CRC member, and then do a crc32, starting with a value of -1U for the
     * crc.
     *
     * XXX It would be nice if ctype supported an offsetof and sizeof so we
     * didn't have to hardcode this.
     */
    buf[0xc] = 0;
    buf[0xd] = 0;
    buf[0xe] = 0;
    buf[0xf] = 0;
    crc32 = mod_crc.crc32_calc(buf);
    if (crc32 !== req.hdr.svp_crc32) {
        this.log.warn({ req: req, orig_crc: req.hdr.svp_crc32,
            calc_crc: crc32 }, 'calculated crcs');
        return callback();
    }

    this.push(rec);
    return callback();
};



module.exports = SVPparser;
