/*jshint node:true*/
'use strict';
var assert = require('goinstant-assert');
var sinon = require('sinon');

// deliberate: node and 3rd party modules before upstream_proxy
var http = require('http');
var https = require('https');
var globalHttpAgent = http.globalAgent;
var globalHttpsAgent = https.globalAgent;
var request = require('request');
var tunnel = require('tunnel');

// deliberate: load after all 3rd party modules
var upstreamProxy = require('../index');

describe('global-proxy', function() {
  // save and restore http_proxy environment variable (yes, it's lower-case by
  // convention).
  var origEnv;
  before(function() {
    origEnv = process.env['http_proxy'];
    delete process.env['http_proxy'];
  });
  after(function() {
    if (origEnv !== undefined) {
      process.env['http_proxy'] = origEnv;
    }
  });


  // sinon setup & teardown
  var sandbox;
  var fakeAgent;

  before(function() {
    sandbox = sinon.sandbox.create();
    fakeAgent = {
      addRequest: sinon.stub()
    };
    sandbox.stub(tunnel, 'httpOverHttp').returns(fakeAgent);
    sandbox.stub(tunnel, 'httpsOverHttp').returns(fakeAgent);

    sandbox.stub(globalHttpAgent, 'addRequest');
    sandbox.stub(globalHttpsAgent, 'addRequest');
  });

  afterEach(function() {
    tunnel.httpOverHttp.reset();
    tunnel.httpsOverHttp.reset();
    globalHttpAgent.addRequest.reset();
    globalHttpsAgent.addRequest.reset();
    fakeAgent.addRequest.reset();
  });

  after(function() {
    sandbox.restore();
    fakeAgent = null;
  });


  describe('invalid configs', function() {
    it('requires a host', function(done) {
      var conf = { host: null, port: 1234 };
      upstreamProxy.initialize(conf, function(err) {
        assert.ok(err);
        assert.equal(err.message, 'upstream proxy host is required');
        upstreamProxy.end(done);
      });
    });

    it('requires a port', function(done) {
      var conf = { host: '127.0.0.1', port: 0 };
      upstreamProxy.initialize(conf, function(err) {
        assert.ok(err);
        assert.equal(err.message, 'upstream proxy port is required');
        upstreamProxy.end(done);
      });
    });
  });

  function proxyEnabledTests() {
    it('(got tunnelling set up)', function() {
      assert.isTrue(upstreamProxy.isProxying);
      sinon.assert.calledOnce(tunnel.httpOverHttp);
      sinon.assert.calledOnce(tunnel.httpsOverHttp);
    });

    it('will proxy http requests', function(done) {
      assert.isTrue(upstreamProxy.isProxying);
      var dummyCb = sinon.stub();
      request.get('http://example.dev/', dummyCb);
      setImmediate(function() {
        sinon.assert.calledOnce(fakeAgent.addRequest);
        sinon.assert.notCalled(globalHttpAgent.addRequest);
        sinon.assert.notCalled(globalHttpsAgent.addRequest);
        done();
      });
    });

    it('will proxy https requests', function(done) {
      assert.isTrue(upstreamProxy.isProxying);
      var dummyCb = sinon.stub();
      request.get('https://example.dev/', dummyCb);
      setImmediate(function() {
        sinon.assert.calledOnce(fakeAgent.addRequest);
        sinon.assert.notCalled(globalHttpAgent.addRequest);
        sinon.assert.notCalled(globalHttpsAgent.addRequest);
        done();
      });
    });
  }

  describe('with proxy enabled', function() {
    var conf = { host: '127.0.0.1', port: 3333 };

    before(function(done) {
      upstreamProxy.initialize(conf, done);
    });
    after(function(done) {
      upstreamProxy.end(done);
    });

    proxyEnabledTests();
  });

  describe('with empty conf and env var enabled', function() {
    before(function(done) {
      process.env['http_proxy'] = 'http://localhost:1234';
      upstreamProxy.initialize({}, done);
    });
    after(function(done) {
      upstreamProxy.end(done);
    });

    proxyEnabledTests();
  });

  // deliberately after the block above
  describe('with proxy disabled', function() {
    it('claims to be disabled', function() {
      assert.isFalse(upstreamProxy.isProxying);
    });

    it('will NOT proxy http requests', function(done) {
      var dummyCb = sinon.stub();
      request.get('http://example.dev/', dummyCb);
      setImmediate(function() {
        sinon.assert.notCalled(fakeAgent.addRequest);
        sinon.assert.calledOnce(globalHttpAgent.addRequest);
        sinon.assert.notCalled(globalHttpsAgent.addRequest);
        done();
      });
    });

    it('will NOT proxy https requests', function(done) {
      var dummyCb = sinon.stub();
      request.get('https://example.dev/', dummyCb);
      setImmediate(function() {
        sinon.assert.notCalled(fakeAgent.addRequest);
        sinon.assert.notCalled(globalHttpAgent.addRequest);
        sinon.assert.calledOnce(globalHttpsAgent.addRequest);
        done();
      });
    });
  });
});
