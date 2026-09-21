'use strict';

const net = require('node:net');

const MAX_IP_DENY_LIST = 64;

function normalizeIp(value) {
  if (typeof value !== 'string') return '';
  const ip = value.trim();
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice(7);
    if (net.isIP(mapped) === 4) return mapped;
  }
  return ip;
}

function isIpAddress(value) {
  const ip = normalizeIp(value);
  return Boolean(ip) && net.isIP(ip) !== 0;
}

function ipDenied(list, ip) {
  const key = normalizeIp(ip);
  return Boolean(key) && Array.isArray(list) && list.includes(key);
}

module.exports = { normalizeIp, isIpAddress, ipDenied, MAX_IP_DENY_LIST };
