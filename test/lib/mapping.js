/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var assert = require('assert-plus');
var mod_common = require('../../lib/common.js');
var mod_moray = require('../../lib/backend/moray');



// --- Exports



function addOverlayMapping(t, opts) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.object(opts.params, 'opts.params');
    assert.string(opts.params.cn_uuid, 'opts.params.cn_uuid');
    assert.optionalBool(opts.params.deleted, 'opts.params.deleted');
    assert.string(opts.params.ip, 'opts.params.ip');
    assert.string(opts.params.mac, 'opts.params.mac');
    assert.number(opts.params.vnet_id, 'opts.params.vnet_id');

    var val = {
        cn_uuid: opts.params.cn_uuid,
        ip: mod_common.IPv6obj(opts.params.ip),
        mac: mod_common.macToInt(opts.params.mac),
        vnet_id: opts.params.vnet_id,
        deleted: opts.params.deleted || false
    };

    mod_moray.addOverlayMapping(val, function _afterUnderlay(err) {
        t.ifErr(err, 'add overlay mapping');
        return t.end();
    });
}


function addUnderlayMapping(t, opts) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.object(opts.params, 'opts.params');
    assert.string(opts.params.cn_uuid, 'opts.params.cn_uuid');
    assert.string(opts.params.ip, 'opts.params.ip');
    assert.number(opts.params.port, 'opts.params.port');

    var val = {
        cn_uuid: opts.params.cn_uuid,
        ip: mod_common.IPv6obj(opts.params.ip),
        port: opts.params.port
    };

    mod_moray.addUnderlayMapping(val, function _afterUnderlay(err) {
        t.ifErr(err, 'add underlay mapping');
        return t.end();
    });
}



module.exports = {
    addOverlay: addOverlayMapping,
    addUnderlay: addUnderlayMapping
};
