/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * SDC VLAN Protocol serializer
 */

'use strict';

var common = require('./common');
var stream = require('stream');
var types = require('./types');
var util = require('util');
var mod_crc = require('./crc32.js');



// --- Exports



function SVPserializer(opts) {
    opts.objectMode = true;
    this.log = opts.log.child({ component: 'serializer' });

    stream.Transform.call(this, opts);
}

util.inherits(SVPserializer, stream.Transform);

/**
 * Serializing a portolan message is accomplished via ctypes, which
 * unfortunately does not support variable-length arrays as called for by the
 * LOG_RM and LOG_ACK messages. The array parts of those messages have been
 * left unspecified in etc/svp-types.json, and are instead appended to the
 * values to be serialized individually.
 */
SVPserializer.prototype._transform =
    function _svpSerTransform(msg, _enc, callback) {

    var log = common.childLogger(this.log, msg);
    log.debug({ message: msg }, 'serialize message');

    var opInfo = types.opInfo(msg.svp_type);
    var buf;
    var bufData;
    var bufSize = opInfo.sizeofReq;

    var fixedPart;
    var arrPart = [];

    var crc32;

    // XXX: rename to svp_op?
    switch (msg.svp_type) {
    case types.svp_op.SVP_R_PING:
        // No value: just return the header
        break;

    case types.svp_op.SVP_R_PONG:
        // No value: just return the header
        break;

    case types.svp_op.SVP_R_VL2_ACK:
        fixedPart = [
            msg.svp_msg.vl2_status,
            msg.svp_msg.vl2_port,
            msg.svp_msg.vl2_addr.toByteArray()
        ];
        break;

    case types.svp_op.SVP_R_VL2_REQ:
        fixedPart = [
            common.macToArr(msg.svp_msg.vl2_mac),
            [ 0, 0 ], // padding
            msg.svp_msg.vl2_vnetid
        ];
        break;

    case types.svp_op.SVP_R_VL3_ACK:
        fixedPart = [
            msg.svp_msg.vl3_status,
            common.intToMacArrayOfNums(msg.svp_msg.vl3_mac),
            msg.svp_msg.vl3_port,
            msg.svp_msg.vl3_addr.toByteArray()
        ];
        break;

    case types.svp_op.SVP_R_VL3_REQ:
        fixedPart = [
            msg.svp_msg.vl3_ip.toByteArray(),
            (msg.svp_msg.vl3_ip.isIPv4MappedAddress() ?
                types.svp_vl3_type.SVP_VL3_IP :
                types.svp_vl3_type.SVP_VL3_IPV6),
            msg.svp_msg.vl3_vnetid
        ];
        break;

    case types.svp_op.SVP_R_LOG_REQ:
        fixedPart = [
            msg.svp_msg.lr_count,
            msg.svp_msg.lr_ip.toByteArray(),
            (msg.svp_msg.lr_ip.isIPv4MappedAddress() ?
                types.svp_vl3_type.SVP_VL3_IP :
                types.svp_vl3_type.SVP_VL3_IPV6)
        ];
        break;

    case types.svp_op.SVP_R_LOG_ACK:
        // See block comment re: construction of this message.
        fixedPart = [
            msg.svp_msg.log_status
        ];

        for (var i_log = 0; i_log < msg.svp_msg.log_data.length; i_log++) {
            var datum = msg.svp_msg.log_data[i_log];

            var svpLogType = types.svp_log_type[datum.record.type];

            log.trace({datum: datum}, 'datum to serialize');

            // common initial section
            var record = [
                svpLogType,
                common.uuidToArr(datum.id)
            ];

            /*
             * The record's key names come from portolan-moray's event handling.
             */
            switch (svpLogType) {
            case types.svp_log_type.SVP_LOG_VL2:
                record.push(common.intToMacArrayOfNums(datum.record.mac));
                record.push([0, 0]); // padding
                record.push(datum.record.vnet_id);
                break;

            case types.svp_log_type.SVP_LOG_VL3:
                record.push(datum.record.ip.toByteArray());
                record.push([0, 0]); // padding
                record.push(datum.record.vlan);
                record.push(datum.record.vnet_id);
                break;

            case types.svp_log_type.SVP_LOG_ROUTE:
                record.push(datum.record.src_vnet_id);
                record.push(datum.record.dst_vnet_id);
                record.push(datum.record.dcid);
                record.push(datum.record.srcip.toByteArray());
                record.push(datum.record.dstip.toByteArray());
                record.push(datum.record.src_vlan_id);
                record.push(datum.record.dst_vlan_id);
                record.push(datum.record.src_prefixlen);
                record.push(datum.record.dst_prefixlen);
                record.push([0, 0]); // padding
                break;

            default:
                // XXX - unrecoverable. Needs to err.
                log.warn({ log_record: datum },
                    'unknown svp_log_type');
                return callback();
            }

            // Works around ctypes limitation on variable-length arrays by
            // pushing each log to the 'array part' of the message,
            // serialized below.
            arrPart.push({
                log: {
                    type: types.svp_log_typedef[datum.record.type],
                    value: record
                },
                offset: bufSize
            });
            bufSize += types.sizeof[datum.record.type];
        }
        break;

    case types.svp_op.SVP_R_LOG_RM:
        log.trace({ ids: msg.svp_msg.rr_ids }, 'LOG_RM requested');
        fixedPart = [
            msg.svp_msg.rr_count
        ];


        // Works around ctypes limitations in variable length arrays by
        // pushing each of the log_rm UUIDs to the 'array part' of the
        // message.
        arrPart = msg.svp_msg.rr_ids.map(function (uuid, i_id) {
            return {
                id: {
                    type: 'uint8_t[16]',
                    value: common.uuidToArr(uuid)
                },
                offset: bufSize + i_id * 16
            };
        });
        bufSize += arrPart.length * 16;

        log.trace({ arrPart: arrPart }, 'log_rr ids');
        break;

    case types.svp_op.SVP_R_LOG_RM_ACK:
        fixedPart = [
            msg.svp_msg.ra_status
        ];
        break;

    case types.svp_op.SVP_R_ROUTE_ACK:
        fixedPart = [
            msg.svp_msg.sra_status,
            msg.svp_msg.sra_dcid,
            msg.svp_msg.sra_vnetid,
            msg.svp_msg.sra_vlanid,
            msg.svp_msg.sra_port,
            msg.svp_msg.sra_ul3ip.toByteArray(),
            common.intToMacArrayOfNums(msg.svp_msg.sra_vl2_srcmac),
            common.intToMacArrayOfNums(msg.svp_msg.sra_vl2_dstmac),
            msg.svp_msg.sra_src_prefixlen,
            msg.svp_msg.sra_dst_prefixlen,
            [ 0, 0 ]
        ];
        break;

    case types.svp_op.SVP_R_ROUTE_REQ:
        fixedPart = [
            msg.svp_msg.srr_vnetid,
            msg.svp_msg.srr_vlanid,
            [ 0, 0 ], // padding
            msg.svp_msg.srr_srcip.toByteArray(),
            msg.svp_msg.srr_dstip.toByteArray()
        ];
        break;

    default:
        log.warn({ message: msg }, 'unknown message svp_type');
        return callback();
    }

    /*
     * In some cases the serializer is used to send messages to ourselves or to
     * other portolans.  In these cases (specifically outbound pings), be sure
     * that we have our version set.  Note that if this is a response message,
     * msg.svp_ver should have the negotiated version from framer.
     */
    var version = types.version;
    if (msg.svp_ver && msg.svp_ver !== 0) {
        version = msg.svp_ver;
    }

    bufData = [
        { hdr: { type: 'svp_req_t', value: [
                version,
                msg.svp_type,
                bufSize - types.sizeof.SVP_REQ,
                msg.svp_id,
                0
            ] }
        }
    ];

    if (fixedPart) {
        bufData.push({ payload: { type: opInfo.type, value: fixedPart } });
    }

    buf = new Buffer(bufSize);

    log.trace({ bufData: bufData, arrPart: arrPart,
        bufSize: bufSize, opInfo: opInfo },
        'serialized values');

    // write header and fixed part of message
    types.parser.writeData(bufData, buf, 0);

    // final part of workaround for variable-length arrays: write each
    // element of the array part of the message.
    for (var i = 0; i < arrPart.length; i++) {
        var element = arrPart[i];
        var offset = element.offset;
        delete element.offset; // can't be there for writeData()
        log.trace({ element: element, offset: offset },
            'writing array element');
        types.parser.writeData([element], buf, offset);
    }

    /*
     * Calculate the CRC, to do this, we have to first zero the original
     * buffer's CRC member, and then do a crc32, starting with a value of -1U
     * for the crc.
     *
     * XXX It would be nice if ctype supported an offsetof and sizeof so we
     * didn't have to hardcode this or even better, a partial update.
     */
    crc32 = mod_crc.crc32_calc(buf);
    log.trace({ msg: msg, crc: crc32 }, 'serialized calculated crc');
    buf[0xc] = (crc32 & 0xff000000) >>> 24;
    buf[0xd] = (crc32 & 0x00ff0000) >>> 16;
    buf[0xe] = (crc32 & 0x0000ff00) >>> 8;
    buf[0xf] = crc32 & 0x000000ff;

    if (msg.svp_type === types.svp_op.SVP_R_LOG_ACK ||
        msg.svp_type === types.svp_op.SVP_R_LOG_RM_ACK) {
        log.trace({ buf: buf }, 'wrote a buffer');
    }

    this.push(buf);
    return callback();
};

module.exports = SVPserializer;
