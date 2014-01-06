# global-tunnel

Uses [`node-tunnel`](https://npmjs.org/package/tunnel) to configure the [global
`http`](http://nodejs.org/docs/v0.10.24/api/all.html#all_http_globalagent) and
[`https`](http://nodejs.org/docs/v0.10.24/api/all.html#all_https_globalagent)
agents to use an upstream HTTP proxy.

# Usage

To make all HTTP and HTTPS connections go through an outbound HTTP proxy:

```js
var globalTunnel = require('global-tunnel');

globalTunnel.initialize({
  host: '127.0.0.1',
  port: 3129,
  sockets: 50 // for each http and https
}, cb);
```

**Please Note:** HTTPS connections are tunnelled insecurely over HTTP, not
using the `CONNECT` method that a browser would use.

Then to tear-down the global agent and restore node's default global agents:

```js
globalTunnel.end(cb);
```

### Options

- `host` the hostname or IP of the HTTP proxy to use
- `port` the TCP port to use on that proxy
- `sockets` _(optional)_ maximum number of TCP sockets to use in each pool.
  There are two pools: one for HTTP and one for HTTPS.  Uses node's default (5)
  if falsy.

### Auto-Config

The `http_proxy` environment variable will be used if the first parameter to
`globalTunnel.initialize` is null or an empty object.

# Contributing

If you'd like to contribute to or modify global-tunnel, here's a quick guide
to get you started.

## Development Dependencies

- [node.js](http://nodejs.org) >= 0.10

## Set-Up

Download via GitHub and install npm dependencies:

```sh
git clone git@github.com:goinstant/global-tunnel.git
cd global-tunnel

npm install
```

## Testing

Testing is with the [mocha](https://github.com/visionmedia/mocha) framework.
Tests are located in the `test/` directory.

To run the tests:

```sh
npm test
```

# Support

Email [GoInstant Support](mailto:support@goinstant.com) or stop by [#goinstant on freenode](irc://irc.freenode.net#goinstant).

For responsible disclosures, email [GoInstant Security](mailto:security@goinstant.com).

To [file a bug](https://github.com/goinstant/global-tunnel/issues) or
[propose a patch](https://github.com/goinstant/global-tunnel/pulls),
please use github directly.

# Legal

&copy; 2013 GoInstant Inc., a salesforce.com company

Licensed under the BSD 3-clause license.
