// @ts-check

/**
 * @file proxy_http.js
 * @description Outbound HTTP/HTTPS Command Handler (0x05) for Node.js
 * Executes full browser-like HTTP round trips over TLS/HTTPS with Chrome headers,
 * redirect following, decompression, and HAR-compatible response framing.
 */

const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const { URL } = require('node:url');
const { _onUDPMessage } = require('./socks.0.js');

// ============================================================================
// TYPE DECLARATIONS & CONSTANTS
// ============================================================================

/**
 * @typedef {import('./socks.server.js').Server} Server
 * @typedef {import('./socks.server.js').ExtendedSocket} ExtendedSocket
 * @typedef {import('./socks.server.js').RequestInfo} RequestInfo
 */

/**
 * @typedef {Object} IAuthOptions
 * @property {string} [user]
 * @property {string} [pass]
 */

/**
 * @typedef {Object} IRequestOptions
 * @property {string} [method]
 * @property {string} [url]
 * @property {string} [hostname]
 * @property {number} [port]
 * @property {Uint8Array | string} [data]
 * @property {Uint8Array | string} [body]
 * @property {IAuthOptions} [auth]
 * @property {string} [user]
 * @property {string} [pass]
 * @property {Record<string, string>} [headers]
 */

/**
 * @typedef {Object} IResponseOptions
 * @property {string} [url]
 * @property {Record<string, string | string[] | undefined>} [headers]
 * @property {string[]} [rawHeaders]
 * @property {string} [statusText]
 * @property {number} [statusCode]
 * @property {Buffer} [body]
 * @property {string} [httpVersion]
 */

/**
 * @typedef {Object} IRedirectStep
 * @property {string} url
 * @property {number} time
 * @property {number | undefined} statusCode
 * @property {string | undefined} statusText
 * @property {Record<string, string | string[] | undefined> | undefined} headers
 * @property {string | undefined} httpVersion
 * @property {Buffer | undefined} body
 * @property {string | null} redirectUrl
 */

const CMD = Object.freeze({
	CONNECT: 0x01,
	BIND: 0x02,
	UDP: 0x03,
	WS: 0x04,
	HTTP: 0x05
});

const BUF_REP_CMDUNSUPP = Buffer.from([0x05, 0x07]);

// Import Logger fallback
const Logger = require('./socks.0.js').Logger || console;

// // Import SHOWNET optional dependency
// let SHOWNET = (/** @type {any[]} */ ...args) => { };
// try
// {
// 	SHOWNET = require('./shownet');
// } catch(e)
// {
// 	// Optional dependency
// }

/**
 * Standard Modern Chrome Headers for client impersonation
 */
const DEFAULT_CHROME_HEADERS = {
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
	'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
	'Accept-Language': 'en-US,en;q=0.9',
	'Accept-Encoding': 'gzip, deflate, br, zstd',
	'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
	'Sec-Ch-Ua-Mobile': '?0',
	'Sec-Ch-Ua-Platform': '"Windows"',
	'Sec-Fetch-Dest': 'document',
	'Sec-Fetch-Mode': 'navigate',
	'Sec-Fetch-Site': 'cross-site',
	'Sec-Fetch-User': '?1',
	'Upgrade-Insecure-Requests': '1',
	'Connection': 'keep-alive'
};

// ============================================================================
// HELPER UTILITIES
// ============================================================================

/**
 * Decompress gzipped, deflated, or brotli response bodies
 * @param {Buffer} buffer
 * @param {string | string[]} encoding
 * @returns {Promise<Buffer>}
 */
function decompressResponseBody(buffer, encoding)
{
	return new Promise((resolve) =>
	{
		const encString = Array.isArray(encoding) ? encoding.join(',') : encoding || '';
		const enc = encString.toLowerCase().trim();
		if(enc.includes('gzip'))
		{
			zlib.gunzip(buffer, (err, decompressed) => resolve(err ? buffer : decompressed));
		} else if(enc.includes('deflate'))
		{
			zlib.inflate(buffer, (err, decompressed) => resolve(err ? buffer : decompressed));
		} else if(enc.includes('br'))
		{
			zlib.brotliDecompress(buffer, (err, decompressed) => resolve(err ? buffer : decompressed));
		} else
		{
			resolve(buffer);
		}
	});
}

/**
 * Perform a single HTTP/HTTPS request round trip
 * @param {string} targetUrl
 * @param {IRequestOptions} options
 * @returns {Promise<IResponseOptions>}
 */
function requestOnce(targetUrl, options)
{
	return new Promise((resolve, reject) =>
	{
		const parsedUrl = new URL(targetUrl);
		const protocol = parsedUrl.protocol === 'https:' ? https : http;

		/** @type {Record<string, string>} */
		const reqHeaders = { ...DEFAULT_CHROME_HEADERS, ...(options.headers || {}) };

		// Add Basic Auth if provided
		if(options.auth && (options.auth.user || options.auth.pass))
		{
			const credentials = Buffer.from(`${options.auth.user || ''}:${options.auth.pass || ''}`).toString('base64');
			reqHeaders['Authorization'] = `Basic ${credentials}`;
		}

		reqHeaders['Host'] = parsedUrl.host;

		/** @type {http.RequestOptions} */
		const reqOptions = {
			method: options.method || 'GET',
			hostname: parsedUrl.hostname,
			port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === 'https:' ? 443 : 80),
			path: `${parsedUrl.pathname}${parsedUrl.search}`,
			headers: reqHeaders,
			//rejectUnauthorized: false
		};

		console.log('Fetching: ' + parsedUrl);
		const req = protocol.request(reqOptions, (res) =>
		{
			/** @type {Buffer[]} */
			const chunks = [];
			res.on('data', (chunk) => chunks.push(chunk));
			res.on('end', async () =>
			{
				const rawBuffer = Buffer.concat(chunks);
				const decompressed = await decompressResponseBody(rawBuffer, res.headers['content-encoding'] || '');

				console.log('Received: ' + decompressed.length + ' bytes');
				resolve({
					url: targetUrl,
					statusCode: res.statusCode || 200,
					statusText: res.statusMessage || 'OK',
					headers: res.headers,
					rawHeaders: res.rawHeaders,
					body: decompressed,
					httpVersion: res.httpVersion
				});
			});
		});

		req.on('error', (err) => reject(err));

		if(options.data)
		{
			req.write(typeof options.data === 'string' ? options.data : JSON.stringify(options.data));
		}

		req.end();
	});
}

/**
 * Execute HTTP Request with redirect chain tracking (HAR ready)
 * @param {string} initialUrl
 * @param {IRequestOptions} options
 * @param {number} [maxRedirects=10]
 * @returns {Promise<IRedirectStep[]>}
 */
async function fetchWithRedirects(initialUrl, options, maxRedirects = 10)
{
	let currentUrl = initialUrl;
	/** @type {IRedirectStep[]} */
	const redirectChain = [];
	let redirectCount = 0;

	while(redirectCount <= maxRedirects)
	{
		const startTime = Date.now();
		const response = await requestOnce(currentUrl, options);
		const endTime = Date.now();

		const isRedirect = response.statusCode
			? [301, 302, 303, 307, 308].includes(response.statusCode)
			: false;

		const locationHeader = response.headers?.['location'];
		const locationStr = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
		const redirectUrl = locationStr
			? new URL(locationStr, currentUrl).toString()
			: null;

		/** @type {IRedirectStep} */
		const step = {
			url: currentUrl,
			time: endTime - startTime,
			statusCode: response.statusCode,
			statusText: response.statusText,
			headers: response.headers,
			httpVersion: response.httpVersion,
			body: response.body,
			redirectUrl
		};

		redirectChain.push(step);

		if(isRedirect && redirectUrl)
		{
			currentUrl = redirectUrl;
			redirectCount++;
			if(response.statusCode && [301, 302, 303].includes(response.statusCode))
			{
				options.method = 'GET';
				delete options.data;
			}
		} else
		{
			break;
		}
	}

	return redirectChain;
}

// ============================================================================
// MODULAR PROXY HTTP FUNCTION (CMD 0x05)
// ============================================================================

/**
 * Executes HTTP Command (0x05) logic.
 * Decodes reqInfo.data JSON, makes full client HTTP requests with browser impersonation,
 * and packages HAR-ready headers, timing, and decompressed body back to the caller.
 *
 * @this {Server}
 * @param {ExtendedSocket} socket Client control socket requesting HTTP association.
 * @param {RequestInfo} reqInfo Decoded SOCKS request parameters containing target/payload.
 * @param {Function} [onData] Optional incoming raw data callback.
 * @returns {Promise<void>}
 */
async function proxyHTTPCommand(socket, reqInfo, onData)
{
	const remoteAddr = `${reqInfo.dstIP}:${reqInfo.dstPort}`;
	console.log(`Received HTTP (0x05) Command request for target ${remoteAddr}`);

	try
	{
		if(reqInfo.cmd !== CMD.HTTP && reqInfo.cmd !== 0x05)
		{
			console.warn(`Unsupported command ${reqInfo.cmd} passed to proxyHTTPCommand`);
			if(typeof socket.send === 'function')
			{
				socket.send(BUF_REP_CMDUNSUPP, { binary: true });
			}
			if(typeof socket.close === 'function')
			{
				socket.close();
			}
			return;
		}

		const port = socket.dstPort || reqInfo.srcPort || 0;
		this._receivers[port] = socket;

		// if(typeof SHOWNET === 'function' && reqInfo.data)
		// {
		// 	SHOWNET(reqInfo.data, socket, false, true);
		// }

		// 1. Decode payload parameters from reqInfo.data
		/** @type {IRequestOptions} */
		let decodedPayload = {};
		if(reqInfo.data)
		{
			try
			{
				const jsonString = Buffer.isBuffer(reqInfo.data)
					? reqInfo.data.toString('utf-8')
					: String(reqInfo.data);
				decodedPayload = JSON.parse(jsonString);
			} catch(e)
			{
				console.warn('Failed to parse reqInfo.data JSON payload:', e);
			}
		}

		// Determine target URL
		let targetUrl = decodedPayload.url;
		if(!targetUrl)
		{
			const protocol = reqInfo.dstPort === 443 ? 'https' : 'http';
			targetUrl = `${protocol}://${reqInfo.dstIP}:${reqInfo.dstPort}`;
		}

		// Extract authentication and custom request options
		/** @type {IAuthOptions | undefined} */
		const auth = decodedPayload.auth || (decodedPayload.user || decodedPayload.pass
			? { user: decodedPayload.user, pass: decodedPayload.pass }
			: undefined);

		/** @type {IRequestOptions} */
		const requestOpts = {
			method: decodedPayload.method || 'GET',
			headers: decodedPayload.headers || {},
			data: decodedPayload.data || decodedPayload.body,
			auth: auth
		};

		// 2. Perform HTTP round trip
		const redirectChain = await fetchWithRedirects(targetUrl, requestOpts);
		const finalResponse = redirectChain[redirectChain.length - 1];

		// 3. Frame HAR-ready response output
		const outputPayload = {
			status: finalResponse.statusCode,
			statusText: finalResponse.statusText,
			url: finalResponse.url,
			httpVersion: `HTTP/${finalResponse.httpVersion}`,
			headers: finalResponse.headers,
			redirectChain: redirectChain.map(step => ({
				url: step.url,
				status: step.statusCode,
				redirectUrl: step.redirectUrl,
				timeMs: step.time
			})),
			data: finalResponse.body?.toString('utf-8'),
			dataEncoding: 'utf-8'
		};

		const responseBuffer = Buffer.from(JSON.stringify(outputPayload));

		// 4. Send output back through the socket or WebSocket client
		if(socket._socket)
		{
			console.log('Portaling ' + responseBuffer.length + ' bytes');
			debugger;
			_onUDPMessage.call(this, port, false, responseBuffer, {
				address: reqInfo.dstAddr ?? socket._socket.localAddress ?? '',
				port: socket._socket.remotePort ?? 0,
				family: socket._socket.localFamily === 'IPv6' ? 'IPv6' : 'IPv4',
				size: socket._socket.bufferSize
			});
		}
		else if(typeof socket.send === 'function')
		{
			console.log('Sending ' + responseBuffer.length + ' bytes');
			socket.send(responseBuffer, { binary: true });
		}
		else if('write' in socket && typeof socket.write === 'function')
		{
            /** @type {any} */ (socket).write(responseBuffer);
		}
		else
		{
			throw new Error('Don\'t know where to send it.');
		}

	} catch(err)
	{
		console.error('Request error in HTTP Command (0x05) execution:', err);
		const errPayload = Buffer.from(JSON.stringify({
			error: true,
			message: /** @type {Error} */ (err).message,
			code: /** @type {any} */ (err).code || 'ERR_HTTP_PROXY'
		}));

		if(typeof socket.send === 'function')
		{
			socket.send(errPayload, { binary: true });
		} else if('write' in socket && typeof socket.write === 'function')
		{
            /** @type {any} */ (socket).write(errPayload);
		}
	}
}

module.exports = {
	CMD,
	proxyHTTPCommand
};
