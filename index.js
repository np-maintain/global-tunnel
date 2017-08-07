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
var urlStringify = require('url').format;

var pick = require('lodash/pick');
var assign = require('lodash/assign');
var clone = require('lodash/clone');
var tunnel = require('tunnel');

var agents = require('./lib/agents');
exports.agents = agents;

var ENV_VAR_PROXY_SEARCH_ORDER = [ 'https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY' ]

// save the original settings for restoration later.
var ORIGINALS = {
  http: pick(http, 'globalAgent', 'request'),
  https: pick(https, 'globalAgent', 'request'),
  env: pick(process.env, ENV_VAR_PROXY_SEARCH_ORDER)
};
function resetGlobals() {
  assign(http, ORIGINALS.http);
  assign(https, ORIGINALS.https);
  var val;
  for (var key in ORIGINALS.env) {
    val = ORIGINALS.env[key];
    if (val != null) {
      process.env[key] = val;
    }
  }
}

/**
 * Parses the de facto `http_proxy` environment.
 */
function tryParse(url) {
  if (!url) {
    return null;
  }

  var parsed = urlParse(url);

  return {
    protocol: parsed.protocol,
    host: parsed.hostname,
    port: parseInt(parsed.port, 10),
    proxyAuth: parsed.auth
  };
}

// Stringifies the normalized parsed config
function stringifyProxy(conf) {
  return urlStringify({
    protocol: conf.protocol,
    hostname: conf.host,
    port: conf.port,
    auth: conf.proxyAuth
  })
}

globalTunnel.isProxying = false;
globalTunnel.proxyUrl = null;
globalTunnel.proxyConfig = null;

function findEnvVarProxy() {
  var key, val, result;
  for (var i = 0; i < ENV_VAR_PROXY_SEARCH_ORDER.length; i++) {
    key = ENV_VAR_PROXY_SEARCH_ORDER[i];
    val = process.env[key];
    if (val != null) {
      // get the first non-empty
      result = result || val;
      // delete all
      // NB: we do it here to prevent double proxy handling (and for example path change)
      // by us and the `request` module or other sub-dependencies
      delete process.env[key];
    }
  }
  return result;
}

/**
 * Overrides the node http/https `globalAgent`s to use the configured proxy.
 *
 * If the config is empty, the `http_proxy` environment variable is checked. If
 * that's not present, no proxying will be enabled.
 *
 * @param {object} conf
 * @param {string} [conf.protocol]
 * @param {string} conf.host
 * @param {int} conf.port
 * @param {string} [conf.proxyAuth]
 * @param {string} [conf.connect]
 * @param {object} [conf.httpsOptions]
 * @param {int} [conf.sockets] maximum number of sockets to pool
 * (falsy uses node's default).
 */
globalTunnel.initialize = function(conf) {
  // don't do anything if already proxying.
  // To change the settings `.end()` should be called first.
  if (globalTunnel.isProxying) {
    return;
  }

  try {
    // This has an effect of also removing the proxy config
    // from the global env to prevent other modules (like request) doing
    // double handling
    var envVarProxy = findEnvVarProxy();

    if (conf && typeof conf === 'string') {
      // passed string - parse it as a URL
      conf = tryParse(conf);
    } else if (conf) {
      // passed object - take it but clone for future mutations
      conf = clone(conf)
    } else if (envVarProxy) {
      // nothing passed - parse from the env
      conf = tryParse(envVarProxy);
    } else {
      // no config - do nothing
      return;
    }

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

    if (['both', 'neither', 'https'].indexOf(conf.connect) < 0) {
      throw new Error('valid connect options are "neither", "https", or "both"');
    }

    var connectHttp = (conf.connect === 'both');
    var connectHttps = (conf.connect !== 'neither');

    if (conf.httpsOptions) {
      conf.outerHttpsOpts = conf.innerHttpsOpts = conf.httpsOptions;
    }

    http.globalAgent = globalTunnel._makeAgent(conf, 'http', connectHttp);
    https.globalAgent = globalTunnel._makeAgent(conf, 'https', connectHttps);

    http.request = globalTunnel._makeRequest(http, 'http');
    https.request = globalTunnel._makeRequest(https, 'https');

    globalTunnel.isProxying = true;
    globalTunnel.proxyUrl = stringifyProxy(conf);
    globalTunnel.proxyConfig = clone(conf);
  } catch (e) {
    resetGlobals();
    throw e;
  }
};

var _makeAgent = function(conf, innerProtocol, useCONNECT) {
  var outerProtocol = conf.protocol;
  innerProtocol = innerProtocol + ':';

  var opts = {
    proxy: pick(conf, 'host', 'port', 'protocol', 'localAddress', 'proxyAuth'),
    maxSockets: conf.sockets
  };
  opts.proxy.innerProtocol = innerProtocol;

  if (useCONNECT) {
    if (conf.proxyHttpsOptions) {
      assign(opts.proxy, conf.proxyHttpsOptions);
    }
    if (conf.originHttpsOptions) {
      assign(opts, conf.originHttpsOptions);
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
      assign(opts, conf.proxyHttpsOptions);
    }

    if (outerProtocol === 'https:') {
      return new agents.OuterHttpsAgent(opts);
    } else {
      return new agents.OuterHttpAgent(opts);
    }
  }
};

/**
 * Construct an agent based on:
 * - is the connection to the proxy secure?
 * - is the connection to the origin secure?
 * - the address of the proxy
 */
globalTunnel._makeAgent = function(conf, innerProtocol, useCONNECT) {
  var agent = _makeAgent(conf, innerProtocol, useCONNECT);
  // set the protocol to match that of the target request type
  agent.protocol = innerProtocol + ':';
  return agent;
}

/**
 * Override for http.request and https.request, makes sure to default the agent
 * to the global agent. Due to how node implements it in lib/http.js, the
 * globalAgent we define won't get used (node uses a module-scoped variable,
 * not the exports field).
 * @param {string|object} options http/https request url or options
 * @param {function} [cb]
 * @private
 */
globalTunnel._makeRequest = function(httpOrHttps, protocol) {
  return function(options, callback) {
    if (typeof options === 'string') {
      options = urlParse(options);
    } else {
      options = clone(options);
    }

    // Respect the default agent provided by node's lib/https.js
    if (options.agent == null && typeof options.createConnection !== 'function' && options.host) {
      options.agent = options._defaultAgent || httpOrHttps.globalAgent;
    }

    // set the default port ourselves to prevent Node doing it based on the proxy agent protocol
    if (options.protocol === 'https:' || (!options.protocol && protocol === 'https')) {
      options.port = options.port || 443;
    }
    if (options.protocol === 'http:' || (!options.protocol && protocol === 'http')) {
      options.port = options.port || 80;
    }

    return ORIGINALS[protocol].request.call(httpOrHttps, options, callback);
  };
};

/**
 * Restores global http/https agents.
 */
globalTunnel.end = function() {
  resetGlobals();
  globalTunnel.isProxying = false;
  globalTunnel.proxyUrl = null;
  globalTunnel.proxyConfig = null;
};
