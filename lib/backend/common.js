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

module.exports = {
    ipToString: ipToString,
    stringToIp: stringToIp,
    macToInt: macToInt,
    intToMac: intToMac
};

function test() {
    console.log(intToMac(81952921372024));
    console.log(macToInt('78:45:c4:26:89:4a'));
}

if (require.main === module) {
    test();
}
