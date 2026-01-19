var http = require('http');
var corsAnywhere = require('cors-anywhere');

// Create the cors-anywhere server but don't listen directly
var proxy = corsAnywhere.createServer({
  originWhitelist: [],
  requireHeader: [],
  removeHeaders: []
});

// Create a wrapper server that modifies CORS headers for credentials support
var server = http.createServer(function(req, res) {
  var setCorsHeaders = function() {
    var origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    var requestHeaders = req.headers['access-control-request-headers'];
    if (requestHeaders) {
      res.setHeader('Access-Control-Allow-Headers', requestHeaders);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  };

  if (req.method === 'OPTIONS') {
    setCorsHeaders();
    res.writeHead(204);
    res.end();
    return;
  }

  // Store original writeHead to intercept headers
  var originalWriteHead = res.writeHead;

  res.writeHead = function(statusCode, statusMessage, headers) {
    // Handle both (statusCode, headers) and (statusCode, statusMessage, headers) signatures
    if (typeof statusMessage === 'object') {
      headers = statusMessage;
      statusMessage = undefined;
    }

    setCorsHeaders();

    // Call original writeHead
    if (statusMessage) {
      return originalWriteHead.call(res, statusCode, statusMessage, headers);
    }
    return originalWriteHead.call(res, statusCode, headers);
  };

  // Let cors-anywhere handle the request
  proxy.emit('request', req, res);
});

var port = process.env.PORT || 8081;
server.listen(port, '0.0.0.0', function() {
  console.log('CORS Anywhere (with credentials) running on http://localhost:' + port);
});
