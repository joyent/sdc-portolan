/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * JSON file backend
 */

var assert = require('assert-plus');
var fs = require('fs');
var ipaddr = require('ipaddr.js');
var mkdirp = require('mkdirp');
var path = require('path');
var stream = require('stream');
var types = require('../types');
var util = require('util');



/// --- Globals



var VXLAN_PORT = 4789;

/*
 * Format like:
 * [
 *   { "mac": "...", "ip": "...", "vnet_id": 4, cn_id: "..." },
 *   ...
 * ]
 */
var MAC_IP_FILE;
var MAC_IP_CONTENTS;
var MAC_IP_DEFAULT = '[]';

/*
 * Format like:
 * [
 *   "CN UUID": { "ip": "..." }
 * ]
 */
var UNDERLAY_FILE;
var UNDERLAY_CONTENTS;
var UNDERLAY_DEFAULT = '{}';



// --- Internal



/**
 * If the file doesn't exist, initialize it with an empty array
 */
function initFile(file, defaultVal, callback) {
    fs.exists(file, function _afterExists(exists) {
        if (exists) {
            return callback();
        }

        fs.writeFile(file, defaultVal, callback);
    });
}


/**
 * Load MAC_IP_FILE from disk, if it has changed
 */
function loadMacIPfile(callback) {
    // XXX: stat first and return cache if unchanged
    fs.readFile(MAC_IP_FILE, function (err, res) {
        if (err) {
            return callback(err);
        }

        try {
            MAC_IP_CONTENTS = JSON.parse(res.toString());
        } catch (jsonErr) {
            return callback(jsonErr);
        }

        return callback(null, MAC_IP_CONTENTS);
    });
}


/**
 * Load UNDERLAY_FILE from disk, if it has changed
 */
function loadUnderlayFile(callback) {
    // XXX: stat first and return cache if unchanged
    fs.readFile(UNDERLAY_FILE, function (err, res) {
        if (err) {
            return callback(err);
        }

        try {
            UNDERLAY_CONTENTS = JSON.parse(res.toString());
        } catch (jsonErr) {
            return callback(jsonErr);
        }

        return callback(null, UNDERLAY_CONTENTS);
    });
}


/**
 * Return a not found message for a VL2 request
 */
function vl2NotFoundMsg(msg) {
    return {
        svp_type: types.svp_op.SVP_R_VL2_ACK,
        svp_id: msg.svp_id,
        svp_msg: {
            vl2_status: types.svp_status.SVP_S_NOTFOUND,
            vl2_addr: ipaddr.parse('::0'),
            vl2_port: 0
        }
    };
}


/**
 * Return a not found message for a VL3 request
 */
function vl3NotFoundMsg(msg) {
    return {
        svp_type: types.svp_op.SVP_S_NOTFOUND,
        svp_id: msg.svp_id,
        svp_msg: {
            vl3_status: types.svp_status.SVP_S_BADL3TYPE,
            vl3_mac: '00:00:00:00:00:00',
            vl3_addr: ipaddr.parse('::0'),
            vl3_port: 0
        }
    };
}



/**
 * JSON store stream constructor
 */
function JsonStore(opts) {
    opts.objectMode = true;
    this.log = opts.log.child({ component: 'json' });

    if (!this instanceof JsonStore) {
        return new JsonStore(opts);
    }

    stream.Transform.call(this, opts);
}

util.inherits(JsonStore, stream.Transform);


JsonStore.prototype._transform = function _dssTransform(msg, enc, callback) {
    this.log.debug({ message: msg }, 'json store message');

    switch (msg.svp_type) {
        case types.svp_op.SVP_R_VL2_REQ:
            return this.vl2Req(msg, callback);
            break;
        case types.svp_op.SVP_R_VL3_REQ:
            return this.vl3Req(msg, callback);
            break;
        default:
            this.log.warn({ message: msg }, 'unsupported svp_type');
            // XXX: push some sort of error on here?
            return callback();
            break;
    }

    return callback();
};


/**
 * Handle a VL2 lookup request
 */
JsonStore.prototype.vl2Req = function _jsonVl2Req(msg, callback) {
    var self = this;

    loadMacIPfile(function _afterVl2Load(err, table) {
        if (err) {
            // XXX: what to do here?
            return callback();
        }

        var found;

        for (var r in table) {
            var rec = table[r];
            if (rec.mac == msg.svp_msg.vl2_mac &&
                rec.vnet_id == msg.svp_msg.vl2_vnet_id) {
                found = rec;
                break;
            }
        }

        if (!found) {
            self.log.debug({ mac: rec.mac, vnet_id: rec.vnet_id },
                'mac / vnet_id not found');
            self.push(vl2NotFoundMsg(msg));
            return callback();
        }

        loadUnderlayFile(function _aftervl2underlay(cnErr, map) {
            if (cnErr || !map.hasOwnProperty(found.cn_id)) {
                self.log.debug({ found: found }, 'CN mapping not found');
                self.push(vl2NotFoundMsg(msg));
                return callback();
            }

            var cnRec = map[found.cn_id];

            self.push({
                svp_type: types.svp_op.SVP_R_VL2_ACK,
                svp_id: msg.svp_id,
                svp_msg: {
                    vl2_status: types.svp_status.SVP_S_OK,
                    vl2_addr: ipaddr.parse(cnRec.ip),
                    vl2_port: VXLAN_PORT
                }
            });

            return callback();
        });
    });
};


/**
 * Handle a VL3 lookup request
 */
JsonStore.prototype.vl3Req = function _jsonVl3Req(msg, callback) {
    var self = this;

    loadMacIPfile(function _afterVl3Load(err, table) {
        if (err) {
            // XXX: what to do here?
            return callback();
        }

        var found;

        for (var r in table) {
            var rec = table[r];
            // XXX: move the .parse() to when we load?
            var recIP = ipaddr.parse(rec.ip).toString();
            if (recIP == msg.svp_msg.vl3_ip.toString() &&
                rec.vnet_id == msg.svp_msg.vl3_vnet_id) {
                found = rec;
                break;
            }
        }

        if (!found) {
            self.log.debug({ ip: rec.ip.toString(), vnet_id: rec.vnet_id },
                'IP / vnet_id not found');
            self.push(vl3NotFoundMsg(msg));
            return callback();
        }

        loadUnderlayFile(function _aftervl2underlay(cnErr, map) {
            if (cnErr || !map.hasOwnProperty(found.cn_id)) {
                self.log.debug({ found: found }, 'CN mapping not found');
                self.push(vl3NotFoundMsg(msg));
                return callback();
            }

            var cnRec = map[found.cn_id];

            self.push({
                svp_type: types.svp_op.SVP_R_VL3_ACK,
                svp_id: msg.svp_id,
                svp_msg: {
                    vl3_status: types.svp_status.SVP_S_OK,
                    vl3_mac: found.mac,
                    vl3_addr: ipaddr.parse(cnRec.ip),
                    vl3_port: VXLAN_PORT
                }
            });

            return callback();
        });
    });
};



// --- Exports


/**
 * Return a new
 */
function createJsonStream(opts) {
    return new JsonStore(opts);
}


/**
 * Validate config keys needed and initialize the store directory
 */
function initJsonStore(config, callback) {
    assert.string(config.jsonDir, 'config.jsonDir');
    mkdirp.sync(config.jsonDir);

    MAC_IP_FILE = path.join(config.jsonDir, 'vnet_mac_ip.json');
    UNDERLAY_FILE = path.join(config.jsonDir, 'underlay_mappings.json');

    initFile(MAC_IP_FILE, MAC_IP_DEFAULT, function _afterMacInit(err) {
        if (err) {
            return callback(err);
        }

        initFile(UNDERLAY_FILE, UNDERLAY_DEFAULT, callback);
    });
}



module.exports = {
    createStream: createJsonStream,
    init: initJsonStore
};
