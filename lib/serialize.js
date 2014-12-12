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

var stream = require('stream');
var types = require('./types');
var util = require('util');


// --- Internal



/**
 * Turn a MAC address string into a byte array
 */
function macArr(macStr) {
    return macStr.split(':').map(function (m) {
        return parseInt(m, 16);
    });
}



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

SVPserializer.prototype._transform = function _dssTransform(msg, enc, callback) {
    this.log.debug({ message: msg }, 'serialize message');

    var opInfo = types.opInfo(msg.svp_type);
    var buf = new Buffer(opInfo.sizeofReq);
    var type;
    var value;

    // XXX: rename to svp_op?
    switch (msg.svp_type) {
        case types.svp_op.SVP_R_VL2_ACK:
            value = [
                msg.svp_msg.vl2_status,
                msg.svp_msg.vl2_port,
                msg.svp_msg.vl2_addr.toByteArray()
            ];
            break;

        case types.svp_op.SVP_R_VL3_ACK:
            value = [
                msg.svp_msg.vl3_status,
                macArr(msg.svp_msg.vl3_mac),
                msg.svp_msg.vl3_port,
                msg.svp_msg.vl3_addr.toByteArray()
            ];
            break;

        default:
            this.log.warn({ message: msg }, 'unknown message svp_type');
            return;
            break;
    }

    this.log.debug({ opInfo: opInfo }, 'xxx');
    var hdrValue = [
        types.version,
        msg.svp_type,
        opInfo.sizeof,
        msg.svp_id,
        0 // XXX: generate CRC here
    ];

    this.log.debug({ hdrValue: hdrValue, value: value },
        'serialized response values');

    types.parser.writeData( [
        { hdr: { type: 'svp_req_t', value: hdrValue } },
        { payload: { type: opInfo.type, value: value } }
    ], buf, 0);

    this.push(buf);
    return callback();
};

module.exports = SVPserializer;
