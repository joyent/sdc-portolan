/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * SDC VXLAN Protocol framing stream
 */

'use strict';

var mod_assert = require('assert-plus');
var mod_crc = require('./crc32.js');
var mod_stream = require('stream');
var mod_types = require('./types');
var mod_util = require('util');


// --- Internal

function SVPFramer(opts) {
    this.log = opts.log.child({ component: 'framer' });
    this.svpf_msgBuffer = new Buffer(0);

    mod_stream.Transform.call(this, {
        objectMode: true,
        highWaterMark: 0
    });
}

mod_util.inherits(SVPFramer, mod_stream.Transform);


// Attempts to parse an SVP header from the msgBuffer.
// XXX - Currently relies only on parser success, see NET-333.
// XXX emit an actual error here.
SVPFramer.prototype.parseHeader = function parseHeader() {
    return mod_types.parser.readData([ { hdr: { type: 'svp_req_t' } } ],
        this.svpf_msgBuffer, 0);
};

/*
 * Check the CRC, to do this, we have to first zero the original buffer's
 * CRC member, and then do a crc32, starting with a value of -1U for the
 * crc.
 *
 * XXX It would be nice if ctype supported an offsetof and sizeof so we
 * didn't have to hardcode this for SVP.
 */
SVPFramer.prototype.crc = function crc(len) {
    this.svpf_msgBuffer[0xc] = 0;
    this.svpf_msgBuffer[0xd] = 0;
    this.svpf_msgBuffer[0xe] = 0;
    this.svpf_msgBuffer[0xf] = 0;
    return mod_crc.crc32_calc(this.svpf_msgBuffer, len);
};

/*
 * Initially we have an empty buffer. Upon receiving a chunk, we store it
 * to the buffer, then:
 *
 *   - is the buffer long enough to contain a header?
 *     - no: callback(), wait for next chunk.
 *   - the header provides a length & CRC
 *     - error: not a parseable error, callback(err), drop connection to
 *       force a varpd connection reset?
 *   - the buffer is long enough to contain the whole message?
 *     - no: callback(), wait for the next chunk.
 *   - the message passes the CRC check?
 *     - error: not a parseable message, drop msgBuffer.
 *   - push(message), trim buffer.
 *   - repeat from header length check.
 */
SVPFramer.prototype._transform =
    function _svpFrameTransform(chunk, _enc, callback) {


    mod_assert.ok(Buffer.isBuffer(chunk), 'msg Buffer');

    var log = this.log;
    var hdrSize = mod_types.sizeof.SVP_REQ;
    var msgCount = 0;
    var msgSize;
    var actualCRC;
    var metrics = {
        labels: {},
        timer: process.hrtime()
    };

    this.svpf_msgBuffer = Buffer.concat([this.svpf_msgBuffer, chunk]);

    // some messages (e.g., ping) have no data portion.
    while (this.svpf_msgBuffer.length >= hdrSize) {
        var msg = {};
        msg.svp_req = this.parseHeader();
        msg.metrics = metrics;
        log.debug({ msg_svp_req_hdr: msg.svp_req.hdr, msgCount: msgCount++ },
            'message header');

        // There is a distinction between what the message indicates as its
        // size, and the expected size of the message derived from ctypes.
        // We check the former here & the latter in the parser.
        msgSize = hdrSize + msg.svp_req.hdr.svp_size;

        if (this.svpf_msgBuffer.length < msgSize) {
            return callback();
        }

        actualCRC = this.crc(msgSize);

        if (actualCRC !== msg.svp_req.hdr.svp_crc32) {
            log.warn({ svp_req: msg.svp_req,
                orig_crc: msg.svp_req.hdr.svp_crc32, calc_crc: actualCRC,
                msgSize: msgSize }, 'mismatched crcs');
            log.trace(
                { buffer: this.svpf_msgBuffer.slice(0,
                    Math.min(msgSize, 2048)).toJSON() },
                'mismatched crc - buffer contents');
            // XXX: emit an error and/or drop connection here.
            this.svpf_msgBuffer = new Buffer();
            return callback();
        }

        msg.svp_buf = this.svpf_msgBuffer.slice(0, msgSize);
        this.svpf_msgBuffer = this.svpf_msgBuffer.slice(msgSize);

        this.push(msg);
    } // end while - we have exhausted the msgBuffer.
    return callback();
};

module.exports = SVPFramer;
