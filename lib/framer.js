/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * SDC VXLAN Protocol framing stream
 */

var mod_crc = require('./crc32.js');
var stream = require('stream');
var types = require('./types');
var util = require('util');


// --- Internal

function SVPFramer(opts) {
    this.log = opts.log.child({ component: 'framer '});
    opts.objectMode = true;

    this.msgBuffer = new Buffer(0);

    if (!this instanceof SVPFramer) {
        return new SVPFramer(opts);
    }

    stream.Transform.call(this, opts);
}

util.inherits(SVPFramer, stream.Transform);


// Attempts to parse an SVP header from the msgBuffer.
// XXX - Currently relies only on parser success, see NET-333.
// XXX emit an actual error here.
SVPFramer.prototype.parseHeader = function parseHeader() {
    return types.parser.readData([ { hdr: { type: 'svp_req_t' } } ],
        this.msgBuffer, 0);
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
    this.msgBuffer[0xc] = 0;
    this.msgBuffer[0xd] = 0;
    this.msgBuffer[0xe] = 0;
    this.msgBuffer[0xf] = 0;
    return mod_crc.crc32_calc(this.msgBuffer, len);
};

/*
 * Initially we have an empty buffer. Upon receiving a chunk, we store it
 * to the buffer, then:
 *
 *   - is the buffer is long enough to contain a header?
 *     - no: callback(), wait for next chunk.
 *   - the header provides a length & CRC
 *     - error: not a parseable error, callback(err), drop connection to
 *       force a varpd reset?
 *   - the buffer is long enough to contain the whole message?
 *     - no: callback(), wait for the next chunk.
 *   - the message passes the CRC check?
 *     - error: not a parseable message, drop msgBuffer.
 *   - push(message), trim buffer.
 *   - repeat from header length check.
 */
SVPFramer.prototype._transform =
    function _svpFrameTransform(chunk, end, callback) {

    var log = this.log;
    var hdrSize = types.sizeof.SVP_REQ;
    var msgSize;
    var actualCRC;

    this.msgBuffer = Buffer.concat([this.msgBuffer, chunk]);

    // some messages (e.g., ping) have no data portion.
    while (this.msgBuffer.length >= hdrSize) {
        var msg = {};
        msg.svp_req = this.parseHeader();
        log.debug({ msg_svp_req_hdr: msg.svp_req.hdr }, 'message header');

        // There is a distinction between what the message indicates as its
        // size, and the expected size of the message derived from ctypes.
        // We check the former here & the latter in the parser.
        msgSize = hdrSize + msg.svp_req.hdr.svp_size;

        if (this.msgBuffer.length < msgSize) {
            return callback();
        }

        actualCRC = this.crc(msgSize);

        if (actualCRC !== msg.svp_req.hdr.svp_crc32) {
            log.warn({ svp_req: msg.svp_req,
                orig_crc: msg.svp_req.hdr.svp_crc32, calc_crc: actualCRC,
                msgSize: msgSize }, 'mismatched crcs');
            log.trace({ buffer: this.msgBuffer.slice(0, msgSize).toJSON() },
                'mismatched crc - buffer contents');
            // XXX: emit an error and/or drop connection here.
            this.msgBuffer = new Buffer();
            return callback();
        }

        msg.buf = new Buffer(msgSize);
        this.msgBuffer.copy(msg.buf, 0, 0, msgSize);
        this.msgBuffer = this.msgBuffer.slice(msgSize);

        this.push(msg);
    } // end while - we have exhausted the msgBuffer.
    return callback();
};

module.exports = SVPFramer;
