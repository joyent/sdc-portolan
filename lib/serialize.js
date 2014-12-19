/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * SDC VLAN Protocol serializer
 */

var common = require('./common');
var stream = require('stream');
var types = require('./types');
var util = require('util');
var mod_crc = require('./crc32.js');



// --- Exports



function SVPserializer(opts) {
    opts.objectMode = true;
    this.log = opts.log.child({ component: 'serializer' });

    if (!this instanceof SVPserializer) {
        return new SVPserializer(opts);
    }

    stream.Transform.call(this, opts);
}

util.inherits(SVPserializer, stream.Transform);

SVPserializer.prototype._transform =
    function _svpSerTransform(msg, enc, callback) {
    this.log.debug({ message: msg }, 'serialize message');

    var opInfo = types.opInfo(msg.svp_type);
    var buf = new Buffer(opInfo.sizeofReq);
    var crc32;
    var value;

    // XXX: rename to svp_op?
    switch (msg.svp_type) {
        case types.svp_op.SVP_R_PING:
            // No value: just return the header
            break;

        case types.svp_op.SVP_R_PONG:
            // No value: just return the header
            break;

        case types.svp_op.SVP_R_VL2_ACK:
            value = [
                msg.svp_msg.vl2_status,
                msg.svp_msg.vl2_port,
                msg.svp_msg.vl2_addr.toByteArray()
            ];
            break;

        case types.svp_op.SVP_R_VL2_REQ:
            value = [
                common.macToArr(msg.svp_msg.vl2_mac),
                [ 0, 0 ], // padding
                msg.svp_msg.vl2_vnetid
            ];
            break;

        case types.svp_op.SVP_R_VL3_ACK:
            value = [
                msg.svp_msg.vl3_status,
                common.intToMacArray(msg.svp_msg.vl3_mac),
                msg.svp_msg.vl3_port,
                msg.svp_msg.vl3_addr.toByteArray()
            ];
            break;

        case types.svp_op.SVP_R_VL3_REQ:
            value = [
                msg.svp_msg.vl3_ip.toByteArray(),
                (msg.svp_msg.vl3_ip.isIPv4MappedAddress() ?
                    types.svp_vl3_type.SVP_VL3_IP :
                    types.svp_vl3_type.SVP_VL3_IPV6),
                msg.svp_msg.vl3_vnetid
            ];
            break;

        default:
            this.log.warn({ message: msg }, 'unknown message svp_type');
            return callback();
    }

    var bufData = [
        { hdr: { type: 'svp_req_t', value: [
                types.version,
                msg.svp_type,
                opInfo.sizeof,
                msg.svp_id,
                0
            ] }
        }
    ];

    if (value) {
        bufData.push({ payload: { type: opInfo.type, value: value } });
    }

    this.log.debug({ bufData: bufData, opInfo: opInfo },
        'serialized response values');

    types.parser.writeData(bufData, buf, 0);

    /*
     * Calculate the CRC, to do this, we have to first zero the original
     * buffer's CRC member, and then do a crc32, starting with a value of -1U
     * for the crc.
     *
     * XXX It would be nice if ctype supported an offsetof and sizeof so we
     * didn't have to hardcode this or even better, a partial update.
     */
    crc32 = mod_crc.crc32_calc(buf);
    this.log.debug({ msg: msg, crc: crc32 }, 'serialized calculated crc');
    buf[0xc] = (crc32 & 0xff000000) >>> 24;
    buf[0xd] = (crc32 & 0x00ff0000) >>> 16;
    buf[0xe] = (crc32 & 0x0000ff00) >>> 8;
    buf[0xf] = crc32 & 0x000000ff;

    this.push(buf);
    return callback();
};

module.exports = SVPserializer;
