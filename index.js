/*jshint node:true */
'use strict';
/**
 * @fileOverview
 * Global proxy settings.
 */
var globalTunnel = exports;
exports.constructor = function globalTunnel(){};

var http = require('http');
var https = require('https');
var urlParse = require('url').parse;

var _ = require('lodash');
var tunnel = require('tunnel');

// save the original globalAgents for restoration later.
var ORIGINALS = {
  http: http.globalAgent,
  https: https.globalAgent
};
function resetGlobals() {
  http.globalAgent = ORIGINALS.http;
  https.globalAgent = ORIGINALS.https;
}

/**
 * Parses the de facto `http_proxy` environment.
 */
function tryParseEnv() {
  var url = process.env['http_proxy'];
  if (!url) {
    return null;
  }

  var conf = {};
  var parsed = urlParse(url);
  conf.host = parsed.hostname;
  conf.port = parsed.port;
  return conf;
}

globalTunnel.isProxying = false;

/**
 * Overrides the node http/https `globalAgent`s to use the configured proxy.
 *
 * If the config is empty, the `http_proxy` environment variable is checked. If
 * that's not present, no proxying will be enabled.
 *
 * @param {object} conf
 * @param {string} conf.host
 * @param {int} conf.port
 * @param {int} [conf.sockets] maximum number of sockets to pool (falsy uses
 * node's default).
 */
globalTunnel.initialize = function(conf, cb) {
  if (globalTunnel.isProxying) {
    return;
  }

  conf = conf || {};
  if (_.isEmpty(conf)) {
    conf = tryParseEnv();
    if (!conf) {
      globalTunnel.isProxying = false;
      return;
    }
  }

  if (!conf.host) {
    return cb(new Error('upstream proxy host is required'));
  }
  if (!conf.port) {
    return cb(new Error('upstream proxy port is required'));
  }

  var proxyConf = {
    proxy: {
      host: conf.host,
      port: conf.port
    },
    maxSockets: conf.sockets // falsy uses node's default
  };

  try {
    http.globalAgent  = tunnel.httpOverHttp(proxyConf);
    https.globalAgent = tunnel.httpsOverHttp(proxyConf);
    globalTunnel.isProxying = true;
  } catch (e) {
    resetGlobals();
    throw e;
  }

  cb();
};

/**
 * Restores global http/https agents.
 */
globalTunnel.end = function(cb) {
  resetGlobals();
  globalTunnel.isProxying = false;
  cb();
};
