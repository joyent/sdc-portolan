/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * SDC VXLAN Protocol parser
 */

var mod_common = require('./common');
var mod_ipaddr = require('ipaddr.js');
var mod_uuid = require('node-uuid');
var stream = require('stream');
var types = require('./types');
var util = require('util');



// --- Internal



/**
 * Create an IPv6 address object given an array of 16 bytes
 */
function ipFromArr(arr) {
    return new mod_ipaddr.IPv6([
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

// NET-334 TODO: incoming object format should be something like:
// {
//     svp_req: { hdr: ... }
//     buf: <Buffer>
// }
SVPparser.prototype._transform =
        function _svpParseTransform(msg, enc, callback) {
    var log = this.log;

    var payload;

    log.debug({ msg: msg }, 'msg');

    var opInfo = types.opInfo(msg.svp_req.hdr.svp_op);
    var offset;

    if (opInfo.type === undefined) {
        // We don't have a way of formulating a response yet
        log.warn({ hdr: msg.svp_req.hdr }, 'unsupported svp_op');
        // XXX: need to pass on an error
        return;
    }

    var logOpts = {
        req_id: mod_uuid.v4(),
        req_svp_op: msg.svp_req.hdr.svp_op,
        req_svp_name: opInfo.name,
        req_svp_id: msg.svp_req.hdr.svp_id
    };
    log = log.child(logOpts);

    log.debug({ hdr: msg.svp_req.hdr }, 'message header');
    log.trace({ buf: msg.buf.toJSON() }, 'message buffer');

    if (opInfo.type) {
        payload = types.parser.readData([ { body: { type: opInfo.type } } ],
            msg.buf, types.sizeof.SVP_REQ);
        log.debug({ body: payload.body }, 'message body');
    }

    var rec = {
        logOpts: logOpts,
        svp_type: msg.svp_req.hdr.svp_op,
        svp_id: msg.svp_req.hdr.svp_id,
        svp_msg: { }
    };

    switch (msg.svp_req.hdr.svp_op) {
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
                vl2_mac: mod_common.macArrToInt(payload.body.sl2r_mac),
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
                vl3_mac: mod_common.macArrToInt(payload.body.sl3a_mac),
                vl3_port: payload.body.sl3a_uport,
                vl3_ip: ipFromArr(payload.body.sl3a_uip)
            };
            break;

        case types.svp_op.SVP_R_LOG_REQ:
            rec.svp_msg = {
                lr_ip: ipFromArr(payload.body.svlr_ip),
                lr_count: payload.body.svlr_count
            };
            break;

        case types.svp_op.SVP_R_LOG_ACK:
            var logSize;
            var logType;
            var logTypedef;
            var la_record;
            var la_data = [];
            offset = opInfo.sizeofReq;

            log.trace({ hdr: msg.svp_req.hdr, payload: payload, buf: msg.buf,
                offset: offset, hdr: msg.svp_req.hdr },
                'Parser: LOG_ACK message');

            // workaround ctypes array limitations, see also serialize.js
            while (offset < msg.buf.length) {
                logType = types.parser.readData([
                    { svp_log_type: { type: 'uint32_t' } }
                ], msg.buf, offset).svp_log_type;
                logSize = types.sizeof[types.svp_log_type_names[logType]];

                if (offset + logSize > msg.buf.length) {
                    // XXX superfluous? would also fail the crc.
                    log.warn({ buf_length: msg.buf.length, offset: offset,
                        logSize: logSize }, 'malformed log_ack: buffer '
                        + 'length insufficient for log type');
                    return;
                }

                logTypedef = types.svp_log_typedef[
                    types.svp_log_type_names[logType]
                ];

                la_record = types.parser.readData([
                    { log: { type: logTypedef } }
                ], msg.buf, offset).log;

                if (la_record.svl3_ip) {
                    la_record.svl3_ip = ipFromArr(la_record.svl3_ip);
                }

                la_data.push(la_record);
                offset += logSize;
            }

            rec.svp_msg = {
                la_status: payload.body.svla_status,
                la_data: la_data
            };
            break;

        case types.svp_op.SVP_R_LOG_RM:
            offset = opInfo.sizeofReq;
            var count = payload.body.svrr_count;

            rec.svp_msg = {
                rr_count: count,
                rr_ids: []
            };

            if (offset + count * 16 != msg.buf.length) {
                // XXX - superfluous? Would fail CRC.
                log.warn({ buf_length: msg.buf.length, count: count,
                    offset: offset },
                    'malformed log_rm: buffer length incorrect');
                return;
            }

            for (var i = 0; i < count; i++) {
                var arr = (types.parser.readData([
                    { id: { type: 'uint8_t[16]' } }
                ], msg.buf, offset + i * 16)).id;
                rec.svp_msg.rr_ids.push(mod_common.arrToUuid(arr));
            }

            break;

        case types.svp_op.SVP_R_LOG_RM_ACK:
            rec.svp_msg = {
                ra_status: payload.body.svra_status
            };
            break;

        default:
            log.warn({ hdr: msg.svp_req.hdr, body: payload.body },
                'unknown message svp_op');
            return;
    }

    log.debug({ rec: rec }, 'parser: record');
    this.push(rec);
    return callback();
};



module.exports = SVPparser;
