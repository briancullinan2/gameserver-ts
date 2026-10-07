// @ts-check

/**
 * @file proxy_ws.js
 * @description Outbound WebSocket Client/Bridge Command Handler for Node.js
 */

const { Socket } = require('node:dgram');
const WebSocket = require('ws');
const { _onProxyError, _onUDPMessage } = require('./socks.0.js');

// ============================================================================
// TYPE DECLARATIONS & IMPORTS
// ============================================================================

/**
 * @typedef {import('./socks.server.js').Server} Server
 * @typedef {import('./socks.server.js').ExtendedSocket} ExtendedSocket
 * @typedef {import('./socks.server.js').ExtendedWebSocket} ExtendedWebSocket
 * @typedef {import('./socks.server.js').RequestInfo} RequestInfo
 */

/**
 * Extended WebSocket properties for pending payload queue and custom message listeners.
 * @typedef {Object} WSPendingProps
 * @property {Array<Buffer>} [_pending] Pending buffers queued while socket is connecting.
 * @property {(msg: Buffer, info?: any) => void} [_message] Internal UDP message dispatcher.
 * @property {(err: Error) => void} [_error] Internal error handler.
 */

/**
 * @typedef {WebSocket & WSPendingProps} PendingWebSocket
 */

/**
 * Custom SOCKS Command Enums
 */
const CMD = Object.freeze({
	CONNECT: 0x01,
	BIND: 0x02,
	UDP: 0x03,
	WS: 0x04
});

/**
 * SOCKS Reply Constants
 */
const BUF_REP_CMDUNSUPP = Buffer.from([0x05, 0x07]);

// Import Logger or fallback to console
const Logger = require('./socks.0.js').Logger || console;

// Import SHOWNET if available
let SHOWNET = (/** @type {any[]} */ ...args) => { };
try
{
	SHOWNET = require('./shownet');
} catch(e)
{
	// Optional dependency
}

// ============================================================================
// MODULAR PROXY WEBSOCKET FUNCTIONS
// ============================================================================

/**
 * Executes WebSocket Proxy (0x04) logic. Routes incoming proxy requests directly
 * to remote WebSocket targets and bridges incoming traffic to bound local sockets.
 *
 * @this {Server}
 * @param {ExtendedSocket} socket Client control socket requesting WS association.
 * @param {RequestInfo} reqInfo Decoded SOCKS request parameters.
 * @param {Function} [onData] Optional incoming raw data callback.
 * @returns {Promise<void>}
 */
async function proxyWSCommand(socket, reqInfo, onData)
{

	const remoteAddr = `${reqInfo.dstIP}:${reqInfo.dstPort}`;
	console.log(`Received WS Command request for target ${remoteAddr}`);

	try
	{
		// Check command matching (CMD.WS or 0x04)
		if(reqInfo.cmd === CMD.WS || reqInfo.cmd === 0x04)
		{
			const port = socket.dstPort || reqInfo.srcPort || 0;

			/**
			 * Forward inbound message directly to target WebSocket connection
			 * @param {any} msg
			 */
			const onForward = (msg) =>
			{
				const targetWS = /** @type {PendingWebSocket} */ (this._directConnects[remoteAddr]);
				if(targetWS && typeof targetWS._message === 'function')
				{
					targetWS._message(Buffer.from(msg), {
						address: reqInfo.dstIP,
						port: reqInfo.dstPort
					});
				}
			};

			// Safely extract bound local port if socket exists
			let realPort = null;
			if(socket.dstSock instanceof Socket
				&& typeof socket.dstSock.address === 'function')
			{
				const addrInfo = socket.dstSock.address();
				if(typeof addrInfo === 'object' && addrInfo !== null)
				{
					realPort = addrInfo.port;
				}
			}

			this._receivers[port] = socket;

			if(typeof SHOWNET === 'function' && reqInfo.data)
			{
				SHOWNET(reqInfo.data, socket, false, true);
			}

			const onProxyError = typeof _onProxyError === 'function'
				? _onProxyError.bind(this, port)
				: (/** @type {Error} */ err) => console.error(`Proxy Error on port ${port}:`, err);

			const onUDPMessage = typeof _onUDPMessage === 'function'
				? _onUDPMessage.bind(this, port, true)
				: () => { };

			await websocketRequest.call(
				this,
				onProxyError,
				onUDPMessage,
				onForward,
				reqInfo,
				reqInfo.dstIP ?? '',
				realPort
			);

			// Handle socket teardown
			socket.on('close', () =>
			{
				const directWS = /** @type {PendingWebSocket} */ (this._directConnects[remoteAddr]);
				if(directWS && directWS.readyState === WebSocket.OPEN)
				{
					directWS.off('message', onForward);
					directWS.close();
					delete this._directConnects[remoteAddr];
					console.log(`Torn down direct WS bridge for ${remoteAddr}`);
				}
			});
		} else
		{
			console.warn(`Unsupported command ${reqInfo.cmd} passed to proxyWSCommand`);
			if(typeof socket.send === 'function')
			{
				socket.send(BUF_REP_CMDUNSUPP, { binary: true });
			}
			if(typeof socket.close === 'function')
			{
				socket.close();
			}
		}
	} catch(err)
	{
		if(/** @type {any} */ (err)?.code?.includes('ERR_SOCKET_DGRAM_NOT_RUNNING'))
		{
			if(typeof socket.close === 'function')
			{
				socket.close();
			}
		} else
		{
			console.error('Request error in WS Command execution:', err);
		}
	}
}

/**
 * Active Outbound WebSocket Connector and Payload Dispatcher.
 * Passes payloads directly through to the client socket without redundant loopback hops.
 *
 * @this {Server}
 * @param {(err: Error) => void} onError Error callback for WS stream.
 * @param {(message: Buffer, info?: any) => void} onUDPMessage Message dispatcher callback.
 * @param {(message: any) => void} onForward Outbound message bridge callback.
 * @param {RequestInfo} reqInfo SOCKS request metadata.
 * @param {string} dstIP Resolved destination IP.
 * @param {number | null} realPort Local bound listening port (for x-forwarded-port header).
 * @returns {Promise<void>}
 */
async function websocketRequest(
	onError,
	onUDPMessage,
	onForward,
	reqInfo,
	dstIP,
	realPort
)
{
	const remoteAddr = `${dstIP}:${reqInfo.dstPort}`;
	let directWS = /** @type {PendingWebSocket} */ (this._directConnects[remoteAddr]);

	if(!directWS || directWS.readyState > WebSocket.OPEN)
	{
		console.log(`Establishing WebSocket request (Bound local port: ${realPort || 'none'}) -> ws://${remoteAddr}`);

		/** @type {{ headers: Record<string, string> }} */
		const options = { headers: {} };
		if(realPort)
		{
			options.headers['x-forwarded-port'] = String(realPort);
		}
		if(this._forwardIP && this._forwardIP.length > 0)
		{
			options.headers['x-forwarded-for'] = this._forwardIP;
		}

		/** @type {PendingWebSocket} */
		const ws = /** @type {any} */ (new WebSocket(`ws://${remoteAddr}`, options));
		this._directConnects[remoteAddr] = ws;

		ws.on('message', onForward)
			.on('error', (err) =>
			{
				console.error(`WebSocket error on ${remoteAddr}:`, err);
				if(typeof ws._error === 'function')
				{
					ws._error(err);
				}
			})
			.on('open', () =>
			{
				console.log(`Outbound WebSocket connection opened to ws://${remoteAddr}`);
				if(ws._pending && ws._pending.length > 0)
				{
					ws._pending.forEach((data) =>
					{
						if(data) ws.send(data, { binary: true });
					});
					ws._pending = [];
				}
			})
			.on('close', () =>
			{
				delete this._directConnects[remoteAddr];
				console.log(`Outbound WebSocket closed to ws://${remoteAddr}`);
			});

		ws._pending = reqInfo.data ? [reqInfo.data] : [];
		directWS = ws;
	} else if(directWS.readyState !== WebSocket.OPEN)
	{
		// Queue payload if WS handshake is still pending
		if(!directWS._pending)
		{
			directWS._pending = [];
		}
		if(reqInfo.data)
		{
			directWS._pending.push(reqInfo.data);
		}
	} else
	{
		// WS stream is OPEN - send immediately
		if(reqInfo.data)
		{
			directWS.send(reqInfo.data, { binary: true });
		}
	}

	// Attach dynamic handlers
	directWS._message = onUDPMessage;
	directWS._error = onError;
}

// Module Exports
module.exports = {
	proxyWSCommand,
	websocketRequest,
	CMD
};
