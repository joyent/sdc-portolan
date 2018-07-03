/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2018, Joyent, Inc.
 */

/*
 * Utility functions
 */

'use strict';

// TODO: Switch everything to node-ip6addr
var ipaddr = require('ipaddr.js');
var ip6addr = require('ip6addr');
var types = require('./types');
var fmt = require('util').format;



// --- Globals



var MAC_ERR = new Error('Invalid MAC address');
var HEX_RE = /^[A-Fa-f0-9]{1,2}$/;
var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;



// --- Exports



/**
 * Re-add log options added to a logger by createChildLogger() below
 */
function addLogOpts(log, msg) {
    if (log.hasOwnProperty('_plLogOpts')) {
        msg.logOpts = log._plLogOpts;
    }
}


/**
 * Create a child logger for a transform stream, taking into account any
 * log options that may have been set by the previous stream.
 */
function createChildLogger(log, msg) {
    var logOpts = msg.logOpts;
    if (logOpts) {
        log = log.child(logOpts);
        log._plLogOpts = logOpts;
        delete msg.logOpts;
    }

    return log;
}


/**
 * We return IPv6 addresses to clients, so return an ipaddr.js v6 object
 * regardless of the input type.
 */
function createv6obj(ipStr) {
    if (typeof (ipStr) === 'object') {
        return ipStr;
    }

    var ipObj = ipaddr.process(ipStr);
    if (ipObj.kind() === 'ipv4') {
        ipObj = ipObj.toIPv4MappedAddress();
    }

    return ipObj;
}

function createv6subobj(cidr) {
    return (ip6addr.createCIDR(cidr));
}

function cidrToString(cidr) {
    return (cidr.toString({format: 'v4-mapped'}));
}

function ipToString(ip) {
    return (ip.toString());
}

/**
 * Convert an IPv4 string to an IPv6 string
 */
function ipv4StrTov6(ip) {
    return createv6obj(ip).toString();
}

/*
 * Input: '192.168.1.0/24'
 * Output: '::ffff:192.168.1.0/120'
 */
function cidrv4StrTov6(cidr) {
    return cidrToString(createv6subobj(cidr));
}

function stringToIp(ip) {
    return (ipaddr.parse(ip));
}

/*
 * Subnets are stored in IPv4 Mapped IPv6 format, so prefixlen
 * should be > 96.
 */
function cidrPrefixLen(cidr) {
    var subnet = cidr;
    var addr;
    var prefix;

    if (typeof (subnet) === 'string') {
        subnet = ipaddr.parseCIDR(subnet);
    }

    prefix = subnet[1];
    addr = subnet[0];

    if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress() && prefix >= 96) {
        prefix -= 96;
    }

    return prefix;
}

/**
 * Convert an array of bytes to an integer
 */
function macArrToInt(arr) {
    return parseInt(arr.map(function (n) {
        var b = n.toString(16);
        if (b.length === 1) {
            return '0' + b;
        }

        return b;
    }).join(''), 16);
}

/**
 * Convert a MAC address to an array of bytes
 */
function macToArr(mac) {
    return mac.split(':').map(function (m) {
        return parseInt(m, 16);
    });
}

function macToInt(mac) {
    var i = parseInt(mac.split(':').join(''), 16);
    return (i);
}

function intToMac(num) {
    return intToMacArray(num).join(':');
}

function intToMacArray(num, wantNums) {
    var arr;
    var j = 5;
    var str = num.toString(16);
    var i;

    if (wantNums) {
        arr = [0, 0, 0, 0, 0, 0];
    } else {
        arr = ['00', '00', '00', '00', '00', '00'];
    }

    if (str.length % 2 === 1) {
        // zero-pad the front of the string
        str = '0' + str;
    }

    i = str.length - 2;

    while (i >= 0) {
        if (wantNums) {
            arr[j] = parseInt(str.substr(i, 2), 16);
        } else {
            arr[j] = str.substr(i, 2);
        }

        i -= 2;
        j--;
    }

    return arr;
}

function intToMacArrayOfNums(num) {
    return intToMacArray(num, true);
}

/**
 * convert a UUID to an array of bytes
 */
function uuidToArr(uuid) {
    var str = uuid.split('-').join('');
    var nums = [];

    for (var i = 0; i < 16; i++) {
        nums.push(str.substr(2 * i, 2));
    }

    return nums.map(function (num) {
        return parseInt(num, 16);
    });
}

/**
 * convert an array of bytes to a uuid;
 */
function arrToUuid(arr) {
    if (arr.length !== 16) {
        throw new Error('Incorrect array length for uuid');
    }
    var str = arr.map(function (bite) {
        var numstr = '0' + Number(bite).toString(16);
        return numstr.substr(-2);
    }).join('');
    // de305d54-75b4-431b-adb2-eb6b9e546014
    return fmt('%s-%s-%s-%s-%s', str.substr(0, 8), str.substr(8, 4),
        str.substr(12, 4), str.substr(16, 4), str.substr(20));
}

function validateUUID(uuid) {
    if (!UUID_RE.test(uuid)) {
        throw new Error('invalid UUID');
    }
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

function validateSubnet(subnet) {
    ipaddr.parseCIDR(subnet);
}

/**
 * Validate options passed to backend functions
 */
function validateOpts(opts) {
    if (opts.hasOwnProperty('mac')) {
        validateMac(opts.mac);
    }

    if (opts.hasOwnProperty('r_send_mac')) {
        validateMac(opts.r_send_mac);
    }

    if (opts.hasOwnProperty('cn_uuid')) {
        validateCNID(opts.cn_uuid);
    }

    if (opts.hasOwnProperty('ip')) {
        validateIP(opts.ip);
    }

    if (opts.hasOwnProperty('srcip')) {
        validateIP(opts.srcip);
    }

    if (opts.hasOwnProperty('dstip')) {
        validateIP(opts.dstip);
    }

    if (opts.hasOwnProperty('subnet')) {
        validateSubnet(opts.subnet);
    }

    if (opts.hasOwnProperty('r_subnet')) {
        validateSubnet(opts.r_subnet);
    }

    if (opts.hasOwnProperty('net_uuid')) {
        validateUUID(opts.net_uuid);
    }

    if (opts.hasOwnProperty('r_net_uuid')) {
        validateUUID(opts.r_net_uuid);
    }
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
        svp_type: types.svp_op.SVP_R_VL3_ACK,
        svp_id: msg.svp_id,
        svp_msg: {
            vl3_status: types.svp_status.SVP_S_NOTFOUND,
            vl3_mac: 0,
            vl3_addr: ipaddr.parse('::0'),
            vl3_port: 0
        }
    };
}

function vnetRouteNotFoundMsg(msg) {
    return {
        svp_type: types.svp_op.SVP_R_ROUTE_ACK,
        svp_id: msg.svp_id,
        svp_msg: {
            sra_status: types.svp_status.SVP_S_NOTFOUND,
            sra_dcid: 0,
            sra_vnetid: 0,
            sra_vlanid: 0,
            sra_dst_prefixlen: 0,
            sra_src_prefixlen: 0,
            sra_vl2_srcmac: 0,
            sra_port: 0,
            sra_ul3ip: ipaddr.parse('::0'),
            sra_vl2_dstmac: 0
        }
    };
}

var unspecAddr = ipaddr.parse('::');

function fatalResponse(type) {
    switch (type) {
    case types.svp_op.SVP_R_VL2_REQ:
        return {
            svp_msg: {
                vl2_status: type.svp_status.SVP_S_FATAL,
                vl2_port: 0,
                vl2_addr: unspecAddr
            },
            svp_type: types.svp_op.SVP_R_VL2_ACK
        };
    case types.svp_op.SVP_R_VL3_REQ:
        return {
            svp_msg: {
                vl3_status: types.svp_status.SVP_S_FATAL,
                vl3_mac: 0,
                vl3_port: 0,
                vl3_addr: unspecAddr
            },
            svp_type: types.svp_op.SVP_R_VL3_ACK
        };
    case types.svp_op.SVP_R_LOG_REQ:
        return {
            svp_msg: {
                log_status: types.svp_status.SVP_S_FATAL,
                log_data: []
            },
            svp_type: types.svp_op.SVP_R_LOG_ACK
        };
    case types.svp_op.SVP_R_LOG_RM:
        return {
            svp_msg: {
                ra_status: types.svp_status.SVP_S_FATAL
            },
            svp_type: types.svp_op.SVP_R_LOG_RM_ACK
        };
    case types.svp_op.SVP_R_ROUTE_REQ:
        return {
            svp_msg: {
                sra_status: types.svp_status.SVP_S_FATAL,
                sra_dcid: 0,
                sra_vnetid: 0,
                sra_vlanid: 0,
                sra_port: 0,
                sra_ul3ip: unspecAddr,
                sra_vl2_srcmac: 0,
                sra_vl2_dstmac: 0,
                sra_src_prefixlen: 0,
                sra_dst_prefixlen: 0
            },
            svp_type: types.svp_op.SVP_R_ROUTE_ACK
        };
    default:
        throw new Error('Unrecognized request message type');
    }
}

module.exports = {
    addLogOpts: addLogOpts,
    childLogger: createChildLogger,
    fatalResponse: fatalResponse,
    IPv6obj: createv6obj,
    IPv6SubObj: createv6subobj,
    ipToString: ipToString,
    cidrToString: cidrToString,
    cidrPrefixLen: cidrPrefixLen,
    cidrv4StrTov6: cidrv4StrTov6,
    ipv4StrTov6: ipv4StrTov6,
    stringToIp: stringToIp,
    macArrToInt: macArrToInt,
    macToArr: macToArr,
    macToInt: macToInt,
    intToMac: intToMac,
    intToMacArrayOfNums: intToMacArrayOfNums,
    uuidToArr: uuidToArr,
    arrToUuid: arrToUuid,
    validate: {
        cn_uuid: validateCNID,
        ip: validateIP,
        mac: validateMac,
        opts: validateOpts
    },
    vl2NotFoundMsg: vl2NotFoundMsg,
    vl3NotFoundMsg: vl3NotFoundMsg,
    vnetRouteNotFoundMsg: vnetRouteNotFoundMsg
};

function test() {
    console.log(intToMac(81952921372024));
    console.log(macToInt('78:45:c4:26:89:4a'));
}

if (require.main === module) {
    test();
}
