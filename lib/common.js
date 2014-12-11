/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Utility functions
 */

var ipaddr = require('ipaddr.js');

// --- Globals

var MAC_ERR = new Error('Invalid MAC address');
var HEX_RE = /^[A-Fa-f0-9]{1,2}$/;
var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

// --- Exports

/**
 * We return IPv6 addresses to clients, so return an ipaddr.js v6 object
 * regardless of the input type.
 */
function createv6obj(ipStr) {
    if (typeof (ipStr) == 'object') {
        return ipStr;
    }

    var ipObj = ipaddr.process(ipStr);
    if (ipObj.kind() == 'ipv4') {
        ipObj = ipObj.toIPv4MappedAddress();
    }

    return ipObj;
}

function ipToString(ip) {
    return (ip.toString());
}

function stringToIp(ip) {
    return (ipaddr.parse(ip));
}

function macToInt(mac) {
    var i = parseInt(mac.split(':').reverse().join(''), 16);
    return (i);
}

function intToMac(mac) {
    var s = new Array(6).join('00').match(/../g);
    var grouped = mac.toString(16).match(/.{1,2}/g);
    s = s.concat(grouped).reverse.slice(0, 6).join(':');
    return (s);
}

function validateCNID(uuid) {
    if (!UUID_RE.test(uuid)) {
        throw new Error('invalid CN UUID');
    }
}

function validateIP(ip) {
    if (!ipaddr.isValid(ip)) {
        throw new Error('invalid IP address');
    }
}

function validateMac(mac) {
    var spl = mac.split(':');
    if (spl.length !== 6) {
        throw MAC_ERR;
    }

    spl.forEach(function (m) {
        if (!HEX_RE.test(m)) {
            throw MAC_ERR;
        }
    });
}

/**
 * Validate options passed to backend functions
 */
function validateOpts(opts) {
    if (opts.hasOwnProperty('mac')) {
        validateMac(opts.mac);
    }

    if (opts.hasOwnProperty('cn_id')) {
        validateCNID(opts.cn_id);
    }

    if (opts.hasOwnProperty('ip')) {
        validateIP(opts.ip);
    }
}

module.exports = {
    IPv6obj: createv6obj,
    ipToString: ipToString,
    stringToIp: stringToIp,
    macToInt: macToInt,
    intToMac: intToMac,
    validate: {
        cn_id: validateCNID,
        ip: validateIP,
        mac: validateMac,
        opts: validateOpts
    }
};

function test() {
    console.log(intToMac(81952921372024));
    console.log(macToInt('78:45:c4:26:89:4a'));
}

if (require.main === module) {
    test();
}
