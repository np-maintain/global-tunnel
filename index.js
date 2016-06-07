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

var agents = require('./lib/agents');
exports.agents = agents;

// save the original globalAgents for restoration later.
var ORIGINALS = {
  http: _.pick(http, 'globalAgent', 'request'),
  https: _.pick(https, 'globalAgent', 'request')
};
function resetGlobals() {
  _.assign(http, ORIGINALS.http);
  _.assign(https, ORIGINALS.https);
}

/**
 * Parses the de facto `http_proxy` environment.
 */
function tryParse(url) {
  if (!url) {
    return null;
  }

  var conf = {};
  var parsed = urlParse(url);
  conf.protocol = parsed.protocol;
  conf.host = parsed.hostname;
  conf.port = parseInt(parsed.port,10);
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
globalTunnel.initialize = function(conf) {
  if (globalTunnel.isProxying) {
    return;
  }

  conf = conf || {};
  if (typeof conf === 'string') {
    conf = tryParse(conf);
  }

  if (_.isEmpty(conf)) {
    conf = tryParse(process.env['http_proxy']);
    if (!conf) {
      globalTunnel.isProxying = false;
      return;
    }
  }
  conf = _.clone(conf);

  if (!conf.host) {
    throw new Error('upstream proxy host is required');
  }
  if (!conf.port) {
    throw new Error('upstream proxy port is required');
  }

  if (conf.protocol === undefined) {
    conf.protocol = 'http:'; // default to proxy speaking http
  }
  if (!/:$/.test(conf.protocol)) {
    conf.protocol = conf.protocol + ':';
  }

  if (!conf.connect) {
    conf.connect = 'https'; // just HTTPS by default
  }
  switch(conf.connect) {
  case 'both':
    conf.connectHttp = true;
    conf.connectHttps = true;
    break;
  case 'neither':
    conf.connectHttp = false;
    conf.connectHttps = false;
    break;
  case 'https':
    conf.connectHttp = false;
    conf.connectHttps = true;
    break;
  default:
    throw new Error('valid connect options are "neither", "https", or "both"');
  }

  if (conf.httpsOptions) {
    conf.outerHttpsOpts = conf.innerHttpsOpts = conf.httpsOptions;
  }

  try {
    http.globalAgent  = globalTunnel._makeAgent(conf, 'http', conf.connectHttp);
    https.globalAgent = globalTunnel._makeAgent(conf, 'https', conf.connectHttps);

    http.request = globalTunnel._defaultedAgentRequest.bind(http, 'http');
    https.request = globalTunnel._defaultedAgentRequest.bind(https, 'https');

    globalTunnel.isProxying = true;
  } catch (e) {
    resetGlobals();
    throw e;
  }
};

/**
 * Construct an agent based on:
 * - is the connection to the proxy secure?
 * - is the connection to the origin secure?
 * - the address of the proxy
 */
globalTunnel._makeAgent = function(conf, innerProtocol, useCONNECT) {
  var outerProtocol = conf.protocol;
  innerProtocol = innerProtocol + ':';

  var opts = {
    proxy: _.pick(conf, 'host','port','protocol','localAddress'),
    maxSockets: conf.sockets
  };
  opts.proxy.innerProtocol = innerProtocol;

  if (useCONNECT) {
    if (conf.proxyHttpsOptions) {
      _.assign(opts.proxy, conf.proxyHttpsOptions);
    }
    if (conf.originHttpsOptions) {
      _.assign(opts, conf.originHttpsOptions);
    }

    if (outerProtocol === 'https:') {
      if (innerProtocol === 'https:') {
        return tunnel.httpsOverHttps(opts);
      } else {
        return tunnel.httpOverHttps(opts);
      }
    } else {
      if (innerProtocol === 'https:') {
        return tunnel.httpsOverHttp(opts);
      } else {
        return tunnel.httpOverHttp(opts);
      }
    }

  } else {
    if (conf.originHttpsOptions) {
      throw new Error('originHttpsOptions must be combined with a tunnel:true option');
    }
    if (conf.proxyHttpsOptions) {
      // NB: not opts.
      _.assign(opts, conf.proxyHttpsOptions);
    }

    if (outerProtocol === 'https:') {
      return new agents.OuterHttpsAgent(opts);
    } else {
      return new agents.OuterHttpAgent(opts);
    }
  }
};

/**
 * Override for http.request and https.request, makes sure to default the agent
 * to the global agent. Due to how node implements it in lib/http.js, the
 * globalAgent we define won't get used (node uses a module-scoped variable,
 * not the exports field).
 * @param {string} protocol bound during initialization
 * @param {string|object} options http/https request url or options
 * @param {function} [cb]
 * @private
 */
globalTunnel._defaultedAgentRequest = function(protocol, options, callback) {
  var httpOrHttps = this;

  if (typeof options === 'string') {
    options = urlParse(options);
  } else {
    options = _.clone(options);
  }

  // A literal `false` means "no agent at all", other falsey values should use
  // our global agent.
  if (!options.agent && options.agent !== false) {
    options.agent = httpOrHttps.globalAgent;
  }

  if( options.protocol === 'https:' )
      options.port = options.port || 443;

  return ORIGINALS[protocol].request.call(httpOrHttps, options, callback);
};

/**
 * Restores global http/https agents.
 */
globalTunnel.end = function() {
  resetGlobals();
  globalTunnel.isProxying = false;
};
