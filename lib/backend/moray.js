/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Moray backend stream
 */

var assert = require('assert-plus');
var lru = require('lru-cache');
var moray = require('moray');
var stream = require('stream');
var util = require('util');
var vasync = require('vasync');

var common = require('../common.js');
var types = require('../types.js');

var sprintf = util.format;



// -- Globals

/*
 * A shared object so each new stream can use the same moray connection, and use
 * it to keep caches around so we don't start with empty ones for each stream.
 */
var shared = {};



// -- Bucket configs

var vnet_mac_ip = {
    name: 'vnet_mac_ip',
    cfg: {
        index: {
            mac: {
                type: 'number'
            },
            ip: {
                type: 'string'
            },
            cn_id: {
                type: 'string'
            },
            vid: {
                type: 'number'
            },
            version: {
                type: 'number'
            },
            deleted: {
                type: 'boolean'
            }
        },
        options: {
            version: 0
        }
    }
};

var portolan_underlay_mappings = {
    name: 'portolan_underlay_mappings',
    cfg: {
        index: {
            cn_id: {
                type: 'string'
            },
            ip: {
                type: 'string'
            },
            port: {
                type: 'number'
            }
        },
        options: {
            version: 0
        }
    }
};

var cn_net_events = {
    name: 'cn_net_events',
    cfg: {
        index: {
            cn_id: {
                type: 'string'
            },
            vid: {
                type: 'number'
            },
            id: {
                type: 'number'
            }
        },
        options: {
            version: 0
        }
    }
};

var napi_vnetworks = {
    name: 'napi_vnetworks',
    cfg: {
        index: {
            vid: {
                type: 'string'
            },
            owner_uuid: {
                type: 'string'
            },
            start_ip: {
                type: 'string'
            },
            end_ip: {
                type: 'string'
            },
            subnet_start: {
                type: 'string'
            },
            subnet_bits: {
                type: 'number'
            }
        },
        options: {
            version: 0
        }
    }
};

var buckets = [
    vnet_mac_ip,
    portolan_underlay_mappings,
    cn_net_events,
    napi_vnetworks
];



// -- API


function init(config, cb) {
    var client = moray.createClient({
        host: config.host,
        port: config.port,
        log: config.log
    });
    shared.moray = client;

    shared.vl2_cache = lru({
        max: 100,
        maxAge: 10 * 1000
    });

    shared.vl3_cache = lru({
        max: 100,
        maxAge: 10 * 1000
    });

    shared.cn_cache = lru({
        max: 100,
        maxAge: 10 * 1000
    });

    client.on('connect', function createBuckets() {
        client.listBuckets(function (err, existingBuckets) {
            vasync.forEachParallel({
                func: function createBucket(bucket, parallelcb) {
                    var exists = existingBuckets.some(function (b) {
                        return (b.name === bucket.name);
                    });
                    if (exists) {
                        return (setImmediate(function () {
                            parallelcb();
                        }));
                    }
                    client.createBucket(bucket.name, bucket.cfg, parallelcb);
                },
                inputs: buckets
            }, cb);
        });
    });

    return (shared);
}


function createStream(opts) {
    if (!shared.moray) {
        throw new Error('init must be called before creating streams');
    }

    return (new MorayStore({
        log: opts.log,
        moray: shared.moray,
        vl2_cache: shared.vl2_cache,
        vl3_cache: shared.vl3_cache,
        cn_cache: shared.cn_cache
    }));
}


function MorayStore(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.object(opts.moray, 'opts.moray');
    assert.object(opts.vl2_cache, 'opts.vl2_cache');
    assert.object(opts.vl3_cache, 'opts.vl3_cache');
    assert.object(opts.cn_cache, 'opts.cn_cache');

    var self = this;
    if (!opts) {
        opts = {};
    }
    opts.objectMode = true;

    self.moray = opts.moray;
    self.log = opts.log;
    self.vl2_cache = opts.vl2_cache;
    self.vl3_cache = opts.vl3_cache;
    self.cn_cache = opts.cn_cache;

    if (!this instanceof MorayStore) {
        return new MorayStore(opts);
    }

    stream.Transform.call(this, opts);
}
util.inherits(MorayStore, stream.Transform);


MorayStore.prototype._transform = function _transform(input, enc, cb) {
    var self = this;
    var type = input.svp_type;
    if (!type || !types.svp_op_names[type]) {
        return (cb(new Error('invalid type %s', type)));
    }

    var op = types.svp_op_names[type].toLowerCase();
    var fn = '_op_' + op;
    if (!self[fn] || typeof (self[fn]) !== 'function') {
        return (cb(new Error('unknown operation %s', op)));
    }

    self[fn](input, function opDone(err, output) {
        if (err) {
            // TODO: better error handling
            return (cb(err));
        }

        output.svp_id = input.svp_id;
        self.push(output);
        return (cb());
    });
};


MorayStore.prototype._get_cn = function _get_cn(cn, cb) {
    var self = this;

    var cached = self.cn_cache.get(cn);
    if (cached) {
        return (setImmediate(function () {
            cb(null, cached);
        }));
    }

    self.moray.getObject('portolan_underlay_mappings', cn, function (err, obj) {
        if (err) {
            return (cb(err));
        }
        self.cn_cache.set(cn, obj.value);
        return (cb(null, obj.value));
    });
};


MorayStore.prototype._op_svp_r_ping = function _op_svp_r_ping(input, cb) {
    var type  = types.svp_op.SVP_R_PONG;
    var output = {
        svp_type: type
    };

    return (cb(null, output));
};


MorayStore.prototype._op_svp_r_vl2_req = function _op_svp_r_vl2_req(input, cb) {
    var self = this;

    var mac = input.svp_msg.vl2_mac;
    var vnet_id = input.svp_msg.vl2_vnet_id;
    var key = [mac, vnet_id].join(',');

    var cached = self.vl2_cache.get(key);
    if (cached) {
        return (setImmediate(function () {
            cb(null, cached);
        }));
    }

    var type = types.svp_op.SVP_R_VL2_ACK;
    var output = {
        svp_type: type
    };

    var mapping;
    var filter = sprintf('(&(mac=%s)(vid=%s))', mac, vnet_id);
    var opts = {};
    var req = self.moray.findObjects('vnet_mac_ip', filter, opts);

    req.once('error', function searchError(err) {
        self.log.error(err);
        return (cb(err));
    });

    req.on('record', function onRecord(obj) {
        if (obj.value.deleted) {
            return;
        }
        mapping = obj.value;
    });

    req.once('end', function onEnd() {
        if (!mapping) {
            output.svp_msg = {
                vl2_status: types.svp_status.SVP_S_NOTFOUND
            };
            self.vl2_cache.set(key, output);
            return (cb(null, output));
        }
        self._get_cn(mapping.cn_id, function gotCn(err, cn) {
            if (err) {
                self.log.error(err);
                return (cb(err));
            }
            output.svp_msg = {
                vl2_status: types.svp_status.SVP_S_OK,
                vl2_port: cn.port,
                vl2_addr: common.stringToIp(cn.ip)
            };
            self.vl2_cache.set(key, output);
            return (cb(null, output));
        });
    });
};


MorayStore.prototype._op_svp_r_vl3_req = function _op_svp_r_vl3_req(input, cb) {
    var self = this;

    var ip = common.ipToString(input.svp_msg.vl3_ip);
    var vnet_id = input.svp_msg.vl3_vnet_id;
    var key = [ip, vnet_id].join(',');

    var cached = self.vl3_cache.get(key);
    if (cached) {
        return (setImmediate(function () {
            cb(null, cached);
        }));
    }

    var type = types.svp_op.SVP_R_VL3_ACK;
    var output = {
        svp_type: type
    };

    self.moray.getObject('vnet_mac_ip', key, function (err, obj) {
        if (err) {
            if (err.name === 'ObjectNotFoundError') {
                output.svp_msg = {
                    vl3_status: types.svp_status.SVP_S_NOTFOUND
                };
                self.vl3_cache.set(key, output);
                return (cb(null, output));
            }
            self.log.error(err);
            return (cb(err));
        }

        var mapping = obj.value;

        self._get_cn(mapping.cn_id, function (cn_err, cn) {
            if (cn_err) {
                self.log.error(cn_err);
                return (cb(cn_err));
            }

            output.svp_msg = {
                vl3_status: types.svp_status.SVP_S_OK,
                vl3_mac: mapping.mac,
                vl3_port: cn.port,
                vl3_addr: common.stringToIp(cn.ip)
            };

            self.vl3_cache.set(key, output);
            return (cb(null, output));
        });
    });
};




// -- backend manipulation

function addOverlayMapping(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.client, 'opts.client');
    assert.number(opts.mac, 'opts.mac');
    assert.object(opts.ip, 'opts.ip');
    assert.string(opts.cn_id, 'opts.cn_id');
    assert.number(opts.vid, 'opts.vid');
    assert.optionalNumber(opts.version, 'opts.version');
    assert.optionalBool(opts.deleted, 'opts.deleted');

    var client = opts.client || shared.client;
    var key = [opts.mac, opts.vid].join(',');

    var record = {
        mac: opts.mac,
        ip: common.ipToString(opts.ip),
        cn_id: opts.cn_id,
        vid: opts.vid,
        version: opts.version || 1,
        deleted: opts.deleted || false
    };

    client.putObject('vnet_mac_ip', key, record, function (err) {
        if (err) {
            return (cb(err));
        }
        cb();
    });
}


function updateOverlayMapping(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.client, 'opts.client');
    assert.number(opts.mac, 'opts.mac');
    assert.number(opts.vid, 'opts.vid');
    assert.optionalObject(opts.ip, 'opts.ip');
    assert.optionalString(opts.cn_id, 'opts.cn_id');
    assert.optionalNumber(opts.version, 'opts.version');
    assert.optionalBool(opts.deleted, 'opts.deleted');

    var client = opts.client || shared.client;
    var key = [opts.mac, opts.vid].join(',');

    client.getObject('vnet_mac_ip', key, function (err, obj) {
        if (err) {
            return (cb(err));
        }

        var record = {
            mac: obj.mac,
            vid: obj.vid,
            ip: opts.ip ? common.ipToString(opts.ip) : obj.ip,
            cn_id: opts.cn_id || obj.cn_id,
            version: opts.version || obj.version,
            deleted: opts.deleted || obj.deleted
        };

        var putOpts = {
            etag: obj._etag
        };

        client.putObject('vnet_mac_ip', key, record, putOpts, function (err) {
            if (err) {
                return (cb(err));
            }
        });
    });
}


function removeOverlayMapping(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.client, 'opts.client');
    assert.number(opts.mac, 'opts.mac');
    assert.number(opts.vid, 'opts.vid');

    var client = opts.client || shared.client;
    var key = [opts.mac, opts.vid].join(',');

    client.delObject('vnet_mac_ip', key, function (err) {
        if (err) {
            return (cb(err));
        }
        cb();
    });
}


function addUnderlayMapping(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.client, 'opts.client');
    assert.number(opts.mac, 'opts.cn_id');
    assert.object(opts.ip, 'opts.ip');
    assert.number(opts.port, 'opts.port');

    var client = opts.client || shared.client;
    var key = opts.cn_id;

    var record = {
        cn_id: opts.cn_id,
        ip: common.ipToString(opts.ip),
        port: opts.port
    };

    client.putObject('portolan_underlay_mappings', key, record, function (err) {
        if (err) {
            return (cb(err));
        }
        cb();
    });
}


function updateUnderlayMapping(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.client, 'opts.client');
    assert.number(opts.mac, 'opts.cn_id');
    assert.optionalObject(opts.ip, 'opts.ip');
    assert.optionalNumber(opts.port, 'opts.port');

    var client = opts.client || shared.client;
    var key = opts.cn_id;
    var bucket = 'portolan_underlay_mappings';

    client.getObject(bucket, key, function (err, obj) {
        if (err) {
            return (cb(err));
        }

        var record = {
            cn_id: obj.cn_id,
            ip: opts.ip ? common.ipToString(opts.ip) : obj.ip,
            port: opts.port || obj.port
        };

        var putOpts = {
            etag: obj._etag
        };

        client.putObject(bucket, key, record, putOpts, function (err) {
            if (err) {
                return (cb(err));
            }
            cb();
        });
    });
}


function removeUnderlayMapping(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.client, 'opts.client');
    assert.number(opts.mac, 'opts.cn_id');

    var client = opts.client || shared.client;
    var key = opts.cn_id;

    client.delObject('portolan_underlay_mappings', key, function (err) {
        if (err) {
            return (cb(err));
        }
        cb();
    });
}



module.exports = {
    init: init,
    createStream: createStream,

    addOverlayMapping: addOverlayMapping,
    updateOverlayMapping: updateOverlayMapping,
    removeOverlayMapping: removeOverlayMapping,

    addUnderlayMapping: addUnderlayMapping,
    updateUnderlayMapping: updateUnderlayMapping,
    removeUnderlayMapping: removeUnderlayMapping,
};
