/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Portolan client
 */

var mod_assert = require('assert-plus');
var mod_bunyan = require('bunyan');
var mod_common = require('./common');
var mod_net = require('net');
var mod_types = require('./types');
var ParserStream = require('./parser');
var SerializerStream = require('./serialize');



// --- Portolan client class



/**
 * Portolan client class
 */
function PortolanClient(opts) {
    this.client = opts.client;
    this.id = opts.id || 1;
    this.log = opts.log;
}


PortolanClient.prototype.makeReq = function _makeReq(req, callback) {
    var strOpts = { log: this.log };
    var serStream = new SerializerStream(strOpts);
    var parserStream = new ParserStream(strOpts);

    serStream.pipe(this.client).pipe(parserStream);
    parserStream.on('data', callback);
    serStream.write(req);
};


PortolanClient.prototype.vl2Req = function _clientVL2req(opts, callback) {
    mod_assert.object(opts, 'opts');
    mod_assert.string(opts.mac, 'opts.mac');
    mod_assert.number(opts.vid, 'opts.vid');

    this.makeReq({
        svp_type: mod_types.svp_op.SVP_R_VL2_REQ,
        svp_id: this.id++,
        svp_msg: {
            // XXX: should this be a number?
            vl2_mac: opts.mac,
            vl2_vnetid: opts.vid
        }
    }, function (data) {
        var res = {
            status: data.svp_msg.vl2_status,
            status_str: mod_types.statusString(data.svp_msg.vl2_status),
            vl2_port: data.svp_msg.vl2_port,
            vl2_ip: mod_common.ipToString(data.svp_msg.vl2_ip)
        };

        return callback(null, res);
    });
};


PortolanClient.prototype.vl3Req = function _clientVL3req(opts, callback) {
    mod_assert.object(opts, 'opts');
    mod_assert.object(opts.ip, 'opts.ip');
    mod_assert.number(opts.vid, 'opts.vid');

    this.makeReq({
        svp_type: mod_types.svp_op.SVP_R_VL3_REQ,
        svp_id: this.id++,
        svp_msg: {
            vl3_ip: opts.ip,
            vl3_vnetid: opts.vid
        }
    }, function (data) {
        var res = {
            status: data.svp_msg.vl3_status,
            status_str: mod_types.statusString(data.svp_msg.vl3_status),
            vl3_ip: mod_common.ipToString(data.svp_msg.vl3_ip),
            vl3_port: data.svp_msg.vl3_port,
            vl3_mac: mod_common.intToMac(data.svp_msg.vl3_mac)
        };

        return callback(null, res);
    });
};



// --- Exports



function connectClient(opts, callback) {
    mod_assert.object(opts, 'opts');
    mod_assert.string(opts.host, 'opts.host');
    mod_assert.number(opts.port, 'opts.port');
    mod_assert.optionalObject(opts.log, 'opts.log');

    var log = opts.log || mod_bunyan.createLogger({
        name: 'portolan-client',
        level: process.env.LOG_LEVEL || 'fatal'
    });

    var client =  mod_net.createConnection(opts, callback);
    client.on('error', callback);

    return new PortolanClient({
        client: client,
        log: log
    });
}



module.exports = {
    connect: connectClient
};
