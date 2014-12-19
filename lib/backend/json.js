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
var common = require('../common');
var fs = require('fs');
var ipaddr = require('ipaddr.js');
var mkdirp = require('mkdirp');
var path = require('path');
var stream = require('stream');
var types = require('../types');
var util = require('util');



/// --- Globals



/*
 * Format like:
 * [
 *   { "mac": "...", "ip": "...", "vid": 4, cn_id: "..." },
 *   ...
 * ]
 */
var MAC_IP_FILE = {
    contents: '',
    defaultValue: '[]',
    mtime: '',
    name: ''
};

/*
 * Format like:
 * {
 *   "CN UUID": { "ip": "..." }
 * }
 */
var UNDERLAY_FILE = {
    contents: '',
    defaultValue: '{}',
    mtime: '',
    name: ''
};



// --- Internal



/**
 * If the file doesn't exist, initialize it with its default value
 */
function initFile(file, callback) {
    fs.exists(file.name, function _afterExists(exists) {
        if (exists) {
            return callback();
        }

        fs.writeFile(file.name, file.defaultValue, callback);
    });
}


/**
 * Load a file from disk if it has changed.
 */
function loadFile(file, callback) {
    fs.stat(file.name, function _afterStat(err, stats) {
        if (err) {
            return callback(err);
        }

        if (stats.mtime.getTime() == file.mtime) {
            return callback(null, file.contents);
        }

        file.mtime = stats.mtime.getTime();

        fs.readFile(file.name, function (err2, res) {
            if (err2) {
                return callback(err2);
            }

            try {
                file.contents = JSON.parse(res.toString());
            } catch (jsonErr) {
                return callback(jsonErr);
            }

            return callback(null, file.contents);
        });
    });
}


/**
 * Returns true if the two records in MAC_IP_FILE format are equal
 */
function macIPrecEqual(recA, recB) {
    var ipObjA = common.IPv6obj(recA.ip);
    var ipObjB = common.IPv6obj(recB.ip);
    if (recA.mac == recB.mac && ipObjA.toString() == ipObjB.toString()) {
        return true;
    }

    return false;
}


/**
 * Write a new copy of the file
 */
function writeFile(file, records, callback) {
    var filename = util.format('%s.%d.%d', file.name, Date.now(0),
        process.pid);

    fs.writeFile(filename, JSON.stringify(records, null, 2),
        function _afterWrite(err) {
        if (err) {
            return callback(err);
        }

        fs.rename(filename, file.name, callback);
    });
}



// --- JsonStore stream object



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
        case types.svp_op.SVP_R_PING:
            return this.ping(msg, callback);
        case types.svp_op.SVP_R_VL2_REQ:
            return this.vl2Req(msg, callback);
        case types.svp_op.SVP_R_VL3_REQ:
            return this.vl3Req(msg, callback);
        default:
            this.log.warn({ message: msg }, 'unsupported svp_type');
            // XXX: push some sort of error on here?
            return callback();
    }

    return callback();
};


/**
 * Handle a ping
 */
JsonStore.prototype.ping = function _jsonPing(msg, callback) {
    this.push({
        svp_type: types.svp_op.SVP_R_PONG,
        svp_id: msg.svp_id
    });

    return callback();
};


/**
 * Handle a VL2 lookup request
 */
JsonStore.prototype.vl2Req = function _jsonVl2Req(msg, callback) {
    var self = this;

    loadFile(MAC_IP_FILE, function _afterVl2Load(err, table) {
        if (err) {
            // XXX: what to do here?
            return callback();
        }

        var found;

        for (var r in table) {
            var rec = table[r];
            if (rec.mac == msg.svp_msg.vl2_mac
                && rec.vid == msg.svp_msg.vl2_vid) {
                found = rec;
                break;
            }
        }

        if (!found) {
            self.log.debug({ mac: rec.mac, vid: rec.vid },
                'mac / vid not found');
            self.push(common.vl2NotFoundMsg(msg));
            return callback();
        }

        loadFile(UNDERLAY_FILE, function _aftervl2underlay(cnErr, map) {
            if (cnErr || !map.hasOwnProperty(found.cn_id)) {
                self.log.debug({ found: found }, 'CN mapping not found');
                self.push(common.vl2NotFoundMsg(msg));
                return callback();
            }

            var cnRec = map[found.cn_id];

            self.push({
                svp_type: types.svp_op.SVP_R_VL2_ACK,
                svp_id: msg.svp_id,
                svp_msg: {
                    vl2_status: types.svp_status.SVP_S_OK,
                    vl2_addr: ipaddr.parse(cnRec.ip),
                    vl2_port: types.VXLAN_PORT
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

    loadFile(MAC_IP_FILE, function _afterVl3Load(err, table) {
        if (err) {
            // XXX: what to do here?
            return callback();
        }

        var found;
        var msgIPstr = msg.svp_msg.vl3_ip.toString();

        for (var r in table) {
            var rec = table[r];
            // XXX: move the .parse() to when we load?
            var recIP = ipaddr.parse(rec.ip).toString();
            if (recIP == msgIPstr && rec.vid == msg.svp_msg.vl3_vid) {
                found = rec;
                break;
            }
        }

        if (!found) {
            self.log.debug({ ip: msgIPstr, vid: rec.vid },
                'IP / vid not found');
            self.push(common.vl3NotFoundMsg(msg));
            return callback();
        }

        loadFile(UNDERLAY_FILE, function _aftervl2underlay(cnErr, map) {
            if (cnErr || !map.hasOwnProperty(found.cn_id)) {
                self.log.debug({ found: found }, 'CN mapping not found');
                self.push(common.vl3NotFoundMsg(msg));
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
                    vl3_port: types.VXLAN_PORT
                }
            });

            return callback();
        });
    });
};



// --- Exports



/**
 * Add a [ip, mac, cn_id, vid] mapping
 */
function addOverlayMapping(opts, callback) {
    loadFile(MAC_IP_FILE, function _afterOverlayLoad(lErr, records) {
        if (lErr) {
            return callback(lErr);
        }

        for (var r in records) {
            var rec = records[r];

            if (macIPrecEqual(rec, opts)) {
                return callback(new Error('record already exists'));
            }
        }

        records.push({
            cn_id: opts.cn_id,
            ip: opts.ip.toString(),
            mac: opts.mac,
            vid: opts.vid
        });

        writeFile(MAC_IP_FILE, records, callback);
    });
}


/**
 * Add a [cn_id, ip] mapping
 */
function addUnderlayMapping(opts, callback) {
    loadFile(UNDERLAY_FILE, function _afterUnderlayLoad(lErr, cns) {
        if (lErr) {
            return callback(lErr);
        }

        if (cns.hasOwnProperty(opts.cn_id)) {
            return callback(new Error('record already exists'));
        }

        cns[opts.cn_id] = { ip: opts.ip.toString() };
        writeFile(UNDERLAY_FILE, cns, callback);
    });
}


/**
 * Return a new JsonStore stream object
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

    MAC_IP_FILE.name = path.join(config.jsonDir, 'vnet_mac_ip.json');
    UNDERLAY_FILE.name = path.join(config.jsonDir, 'underlay_mappings.json');

    initFile(MAC_IP_FILE, function _afterMacInit(err) {
        if (err) {
            return callback(err);
        }

        initFile(UNDERLAY_FILE, callback);
    });
}



module.exports = {
    addOverlayMapping: addOverlayMapping,
    addUnderlayMapping: addUnderlayMapping,
    createStream: createJsonStream,
    init: initJsonStore
};
