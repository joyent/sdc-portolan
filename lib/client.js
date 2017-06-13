/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Portolan client
 */

'use strict';

var mod_assert = require('assert-plus');
var mod_bunyan = require('bunyan');
var mod_common = require('./common');
var mod_net = require('net');
var mod_types = require('./types');
var FramerStream = require('./framer');
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


PortolanClient.prototype._makeReq = function _makeReq(req, callback) {
    if (!this._serStream) {
        var strOpts = { log: this.log };
        this._serStream = new SerializerStream(strOpts);
        this._framerStream = new FramerStream(strOpts);
        this._parserStream = new ParserStream(strOpts);
        this._serStream.pipe(this.client)
            .pipe(this._framerStream)
            .pipe(this._parserStream);
    }

    this.log.debug({ request: req }, 'request');
    this._parserStream.once('data', callback);
    this._serStream.write(req);
};


PortolanClient.prototype.close = function _close() {
    this.client.end();
};


PortolanClient.prototype.ping = function _ping(callback) {
    this._makeReq({
        svp_id: this.id++,
        svp_type: mod_types.svp_op.SVP_R_PING
    }, function () {
        return callback(null, { status: 'ok' });
    });
};


PortolanClient.prototype.vl2Req = function _clientVL2req(opts, callback) {
    mod_assert.object(opts, 'opts');
    mod_assert.string(opts.mac, 'opts.mac');
    mod_assert.number(opts.vnet_id, 'opts.vnet_id');

    this._makeReq({
        svp_type: mod_types.svp_op.SVP_R_VL2_REQ,
        svp_id: this.id++,
        svp_msg: {
            // XXX: should this be a number?
            vl2_mac: opts.mac,
            vl2_vnetid: opts.vnet_id
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
    mod_assert.number(opts.vnet_id, 'opts.vnet_id');

    this._makeReq({
        svp_type: mod_types.svp_op.SVP_R_VL3_REQ,
        svp_id: this.id++,
        svp_msg: {
            vl3_ip: opts.ip,
            vl3_vnetid: opts.vnet_id
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


PortolanClient.prototype.logReq = function _clientLogReq(opts, callback) {
    mod_assert.object(opts, 'opts');

    mod_assert.object(opts.ip, 'opts.ip');
    mod_assert.number(opts.count, 'opts.count');

    var self = this;
    var msg = {
        lr_ip: opts.ip,
        lr_count: opts.count
    };

    self.log.debug({ msg: msg }, 'client.logReq: start');

    self._makeReq({
        svp_type: mod_types.svp_op.SVP_R_LOG_REQ,
        svp_id: this.id++,
        svp_msg: msg
    }, function (data) {
        self.log.debug({ data: data }, 'client.logReq: finish');

        var res = {
            status: data.svp_msg.la_status,
            status_str: mod_types.statusString(data.svp_msg.la_status),
            la_data: data.svp_msg.la_data.map(function (datum) {
                return Object.keys(datum).reduce(function (obj, prop) {
                    switch (prop) {
                    case 'svl2_type':
                    case 'svl3_type':
                        obj.type = mod_types.svp_log_type_names[datum[prop]];
                        break;
                    case 'svl2_id':
                    case 'svl3_id':
                        obj.id = mod_common.arrToUuid(datum[prop]);
                        break;
                    case 'svl2_mac':
                        obj.mac = mod_common.intToMac(
                            mod_common.macArrToInt(datum[prop]));
                        break;
                    case 'svl3_ip':
                        obj.ip = mod_common.ipToString(datum[prop]);
                        break;
                    case 'svl3_vlan':
                        obj.vlan = datum[prop];
                        break;
                    case 'svl2_vnetid':
                    case 'svl3_vnetid':
                        obj.vnet_id = datum[prop];
                        break;
                    case 'svl2_pad':
                    case 'svl3_pad':
                        break;
                    default:
                        self.log.warn({ datum: datum, property: prop },
                            'unknown property in la_data log, ignoring');
                        break;
                    }
                    return obj;
                }, {});
            })
        };

        return callback(null, res);
    });
};

PortolanClient.prototype.logRm = function _clientLogRm(opts, callback) {
    mod_assert.object(opts, 'opts');
    mod_assert.number(opts.count, 'opts.count');
    mod_assert.arrayOfString(opts.ids, 'opts.ids');

    var self = this;
    var msg = {
        rr_count: opts.count,
        rr_ids: opts.ids
    };

    self.log.debug({ msg: msg }, 'client.logRm: start');

    self._makeReq({
        svp_type: mod_types.svp_op.SVP_R_LOG_RM,
        svp_id: this.id++,
        svp_msg: msg
    }, function (data) {
        self.log.debug({ data: data }, 'client.logReq: finish');

        var res = {
            status: data.svp_msg.ra_status,
            status_str: mod_types.statusString(data.svp_msg.ra_status)
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
