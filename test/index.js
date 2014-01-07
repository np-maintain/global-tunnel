/*jshint node:true*/
'use strict';
var assert = require('goinstant-assert');
var sinon = require('sinon');

// deliberate: node and 3rd party modules before global-tunnel
var EventEmitter = require('events').EventEmitter;
var net = require('net');
var tls = require('tls');
var http = require('http');
var globalHttpAgent = http.globalAgent;
var https = require('https');
var globalHttpsAgent = https.globalAgent;
var request = require('request');

// deliberate: load after all 3rd party modules
var globalTunnel = require('../index');

function newFakeAgent() {
  var fakeAgent = {
    addRequest: sinon.stub()
  };
  return fakeAgent;
}

var origEnv;
function saveEnv() {
  origEnv = process.env['http_proxy'];
  delete process.env['http_proxy'];
}
function restoreEnv() {
  if (origEnv !== undefined) {
    process.env['http_proxy'] = origEnv;
  }
}

describe('global-proxy', function() {
  // save and restore http_proxy environment variable (yes, it's lower-case by
  // convention).
  before(saveEnv);
  after(restoreEnv);


  // sinon setup & teardown
  var sandbox;

  before(function() {
    sandbox = sinon.sandbox.create();

    sandbox.stub(globalHttpAgent, 'addRequest');
    sandbox.stub(globalHttpsAgent, 'addRequest');

    assert.equal(http.Agent.prototype.addRequest,
                 https.Agent.prototype.addRequest);
    sandbox.spy(http.Agent.prototype, 'addRequest');

    sandbox.stub(net, 'createConnection', function() {
      return new EventEmitter();
    });
    sandbox.stub(tls, 'connect', function() {
      return new EventEmitter();
    });
  });

  afterEach(function() {
    // would love to sandbox.reset(), but alas: no such thing
    globalHttpAgent.addRequest.reset();
    globalHttpsAgent.addRequest.reset();
    http.Agent.prototype.addRequest.reset();
    net.createConnection.reset();
    tls.connect.reset();
  });

  after(function() {
    sandbox.restore();
  });


  describe('invalid configs', function() {
    it('requires a host', function() {
      var conf = { host: null, port: 1234 };
      assert.exception(function() {
        globalTunnel.initialize(conf);
      }, 'upstream proxy host is required');
      globalTunnel.end();
    });

    it('requires a port', function() {
      var conf = { host: '10.2.3.4', port: 0 };
      assert.exception(function() {
        globalTunnel.initialize(conf);
      }, 'upstream proxy port is required');
      globalTunnel.end();
    });

    it('clamps tunnel types', function() {
      var conf = { host: '10.2.3.4', port: 1234, connect: 'INVALID' };
      assert.exception(function() {
        globalTunnel.initialize(conf);
      }, 'valid connect options are "neither", "https", or "both"');
      globalTunnel.end();
    });
  });

  function proxyEnabledTests(testParams) {

    function connected(innerProto) {
      var innerSecure = (innerProto === 'https:');

      var called;
      if (testParams.secure) {
        called = tls.connect;
        sinon.assert.notCalled(net.createConnection);
      } else {
        called = net.createConnection;
        sinon.assert.notCalled(tls.connect);
      }

      sinon.assert.calledOnce(called);
      if (typeof called.getCall(0).args[0] === 'object') {
        sinon.assert.calledWith(called, sinon.match.has('port', testParams.port));
        sinon.assert.calledWith(called, sinon.match.has('host', '10.2.3.4'));
      } else {
        sinon.assert.calledWith(called,
                                testParams.port, '10.2.3.4');
      }

      var isCONNECT = testParams.connect === 'both' ||
        (innerSecure && testParams.connect === 'https');
      if (isCONNECT) {
        var expectConnect = 'example.dev:' + (innerSecure ? 443 : 80);
        var whichAgent = innerSecure ? https.globalAgent : http.globalAgent;

        sinon.assert.calledOnce(whichAgent.request);
        sinon.assert.calledWith(whichAgent.request,
                                sinon.match.has('method','CONNECT'));
        sinon.assert.calledWith(whichAgent.request,
                                sinon.match.has('path',expectConnect));
      } else {
        sinon.assert.calledOnce(http.Agent.prototype.addRequest);
        var req = http.Agent.prototype.addRequest.getCall(0).args[0];

        var method = req.method;
        assert.equal(method, 'GET');

        var path = req.path;
        if (innerSecure) {
          assert.match(path, new RegExp('^https://example\\.dev:443/'));
        } else {
          assert.match(path, new RegExp('^http://example\\.dev:80/'));
        }
      }
    }

    var localSandbox;
    beforeEach(function() {
      localSandbox = sinon.sandbox.create();
      if (testParams.connect === 'both') {
        localSandbox.spy(http.globalAgent, 'request');
      }
      if (testParams.connect !== 'neither') {
        localSandbox.spy(https.globalAgent, 'request');
      }
    });
    afterEach(function() {
      localSandbox.restore();
    });

    it('(got proxying set up)', function() {
      assert.isTrue(globalTunnel.isProxying);
    });

    describe('with the request library', function() {
      it('will proxy http requests', function(done) {
        assert.isTrue(globalTunnel.isProxying);
        var dummyCb = sinon.stub();
        request.get('http://example.dev/', dummyCb);
        setImmediate(function() {
          connected('http:');
          sinon.assert.notCalled(globalHttpAgent.addRequest);
          sinon.assert.notCalled(globalHttpsAgent.addRequest);
          done();
        });
      });

      it('will proxy https requests', function(done) {
        assert.isTrue(globalTunnel.isProxying);
        var dummyCb = sinon.stub();
        request.get('https://example.dev/', dummyCb);
        setImmediate(function() {
          connected('https:');
          sinon.assert.notCalled(globalHttpAgent.addRequest);
          sinon.assert.notCalled(globalHttpsAgent.addRequest);
          done();
        });
      });
    });

    describe('using raw request interface', function() {
      it('will proxy http requests', function() {
        var req = http.request({
          method: 'GET',
          path: '/raw-http',
          host: 'example.dev'
        }, function() {});
        req.end();

        connected('http:');
        sinon.assert.notCalled(globalHttpAgent.addRequest);
        sinon.assert.notCalled(globalHttpsAgent.addRequest);
      });

      it('will proxy https requests', function() {
        var req = https.request({
          method: 'GET',
          path: '/raw-https',
          host: 'example.dev'
        }, function() {});
        req.end();

        connected('https:');
        sinon.assert.notCalled(globalHttpAgent.addRequest);
        sinon.assert.notCalled(globalHttpsAgent.addRequest);
      });

      it('request respects explicit agent param', function() {
        var agent = newFakeAgent();
        var req = http.request({
          method: 'GET',
          path: '/raw-http-w-agent',
          host: 'example.dev',
          agent: agent
        }, function() {});
        req.end();

        sinon.assert.notCalled(globalHttpAgent.addRequest);
        sinon.assert.notCalled(globalHttpsAgent.addRequest);
        sinon.assert.notCalled(net.createConnection);
        sinon.assert.notCalled(tls.connect);
        sinon.assert.calledOnce(agent.addRequest);
      });

      describe('request with `false` agent', function() {
        before(function() {
          sinon.stub(http.ClientRequest.prototype, 'onSocket');
        });
        after(function() {
          http.ClientRequest.prototype.onSocket.restore();
        });

        it('uses no agent', function() {
          var createConnection = sinon.stub();
          var req = http.request({
            method: 'GET',
            path: '/no-agent',
            host: 'example.dev',
            agent: false,
            createConnection: createConnection
          }, function() {});
          req.end();

          sinon.assert.notCalled(globalHttpAgent.addRequest);
          sinon.assert.notCalled(globalHttpsAgent.addRequest);
          sinon.assert.calledOnce(createConnection);
        });
      });
    });
  }

  function enabledBlock(conf, testParams) {
    before(function() {
      globalTunnel.initialize(conf);
    });
    after(function() {
      globalTunnel.end();
    });

    proxyEnabledTests(testParams);
  }

  describe('with http proxy in intercept mode', function() {
    var conf = {
      connect: 'neither',
      protocol: 'http:',
      host: '10.2.3.4',
      port: 3333
    };
    enabledBlock(conf, { secure: false, connect: 'neither', port: 3333 });
  });

  describe('with https proxy in intercept mode', function() {
    var conf = {
      connect: 'neither',
      protocol: 'https:',
      host: '10.2.3.4',
      port: 3334
    };
    enabledBlock(conf, { secure: true, connect: 'neither', port: 3334 });
  });

  describe('with http proxy in CONNECT mode', function() {
    var conf = {
      connect: 'both',
      protocol: 'http:',
      host: '10.2.3.4',
      port: 3335
    };
    enabledBlock(conf, { secure: false, connect: 'both', port: 3335 });
  });

  describe('with https proxy in CONNECT mode', function() {
    var conf = {
      connect: 'both',
      protocol: 'https:',
      host: '10.2.3.4',
      port: 3336
    };
    enabledBlock(conf, { secure: true, connect: 'both', port: 3336 });
  });

  describe('with http proxy in mixed mode', function() {
    var conf = {
      protocol: 'http:',
      host: '10.2.3.4',
      port: 3337
    };
    enabledBlock(conf, { secure: false, connect: 'https', port: 3337 });
  });

  describe('with https proxy in mixed mode', function() {
    var conf = {
      protocol: 'https:',
      host: '10.2.3.4',
      port: 3338
    };
    enabledBlock(conf, { secure: true, connect: 'https', port: 3338 });
  });


  describe('using env var', function() {
    after(function() {
      delete process.env['http_proxy'];
    });

    describe('for http', function() {
      before(function() {
        process.env['http_proxy'] = 'http://10.2.3.4:1234';
      });
      enabledBlock({}, { secure: false, connect: 'https', port: 1234 });
    });

    describe('for https', function() {
      before(function() {
        process.env['http_proxy'] = 'https://10.2.3.4:1235';
      });
      enabledBlock({}, { secure: true, connect: 'https', port: 1235 });
    });
  });


  // deliberately after the block above
  describe('with proxy disabled', function() {
    it('claims to be disabled', function() {
      assert.isFalse(globalTunnel.isProxying);
    });

    it('will NOT proxy http requests', function(done) {
      var dummyCb = sinon.stub();
      request.get('http://example.dev/', dummyCb);
      setImmediate(function() {
        sinon.assert.calledOnce(globalHttpAgent.addRequest);
        sinon.assert.notCalled(globalHttpsAgent.addRequest);
        done();
      });
    });

    it('will NOT proxy https requests', function(done) {
      var dummyCb = sinon.stub();
      request.get('https://example.dev/', dummyCb);
      setImmediate(function() {
        sinon.assert.notCalled(globalHttpAgent.addRequest);
        sinon.assert.calledOnce(globalHttpsAgent.addRequest);
        done();
      });
    });
  });
});
