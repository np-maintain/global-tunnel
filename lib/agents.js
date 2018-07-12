/* jshint node:true */
'use strict';

var util = require('util');
var http = require('http');
var HttpAgent = http.Agent;
var https = require('https');
var HttpsAgent = https.Agent;

var pick = require('lodash/pick');

/**
 * Proxy some traffic over HTTP.
 */
function OuterHttpAgent(opts, globalTunnel) {
  HttpAgent.call(this, opts);
  mixinProxying(this, opts.proxy, globalTunnel);
}
util.inherits(OuterHttpAgent, HttpAgent);
exports.OuterHttpAgent = OuterHttpAgent;

/**
 * Proxy some traffic over HTTPS.
 */
function OuterHttpsAgent(opts, globalTunnel) {
  HttpsAgent.call(this, opts);
  mixinProxying(this, opts.proxy, globalTunnel);
}
util.inherits(OuterHttpsAgent, HttpsAgent);
exports.OuterHttpsAgent = OuterHttpsAgent;

/**
 * Override createConnection and addRequest methods on the supplied agent.
 * http.Agent and https.Agent will set up createConnection in the constructor.
 */
function mixinProxying(agent, proxyOpts, globalTunnel) {
  agent.proxy = proxyOpts;

  var orig = pick(agent, 'createConnection', 'addRequest');

  // Make the tcp or tls connection go to the proxy, ignoring the
  // destination host:port arguments.
  agent.createConnection = function(port, host, options) {
    var doProxy = !globalTunnel.proxyConfig.proxyEnableFunction || globalTunnel.proxyConfig.proxyEnableFunction();
    return doProxy ? orig.createConnection.call(this, this.proxy.port, this.proxy.host, options) : 
                     orig.createConnection.call(this, Array.prototype.slice.apply(arguments));
  };

  agent.addRequest = function(req, options) {
    var doProxy = !globalTunnel.proxyConfig.proxyEnableFunction || globalTunnel.proxyConfig.proxyEnableFunction();
    if(doProxy) {
      req.path =
        this.proxy.innerProtocol + '//' + options.host + ':' + options.port + req.path;
      return orig.addRequest.call(this, req, options);
    }
    else {
      return orig.addRequest.call(this, Array.prototype.slice.apply(arguments));
    }
  };
}
