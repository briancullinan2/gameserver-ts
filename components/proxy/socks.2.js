// @ts-check

/**
 * @file proxy_bind.js
 * @description SOCKS5 Command 0x02 (BIND) Handler for inbound TCP listener setup
 */

const { createServer } = require('net');
const { _onProxyError, _onSocketConnect } = require('./socks.0.js');

// ============================================================================
// TYPE DECLARATIONS & IMPORTS
// ============================================================================

/**
 * @typedef {import('./socks.server.js').Server} Server
 * @typedef {import('./socks.server.js').ExtendedSocket} ExtendedSocket
 * @typedef {import('./socks.server.js').RequestInfo} RequestInfo
 */

/**
 * SOCKS5 Protocol Command Enums
 */
const CMD = Object.freeze({
	CONNECT: 0x01,
	BIND: 0x02,
	UDP: 0x03
});

/**
 * SOCKS5 Protocol Reply Constants
 */
const BUF_REP_CMDUNSUPP = Buffer.from([0x05, 0x07]);
const BUF_REP_GENFAIL = Buffer.from([0x05, 0x01]);

// Import Logger or fallback to console
const Logger = require('./socks.0.js').Logger || console;

// ============================================================================
// MODULAR PROXY BIND FUNCTION
// ============================================================================

/**
 * Executes SOCKS5 BIND (0x02) logic to establish an inbound TCP listening socket.
 * Expects execution context (`this`) to be bound to the `Server` instance.
 *
 * @this {Server}
 * @param {ExtendedSocket} socket Control socket requesting BIND.
 * @param {RequestInfo} reqInfo Decoded SOCKS request metadata.
 * @param {Function} [onData] Optional incoming raw data callback.
 * @returns {Promise<void>}
 */
async function proxyBINDCommand(socket, reqInfo, onData)
{


	const remoteAddr = `${reqInfo.dstIP}:${reqInfo.dstPort}`;
	console.log(`Received SOCKS5 BIND request for ${remoteAddr}`);

	try
	{
		if(reqInfo.cmd === CMD.BIND)
		{
			if(socket.parser)
			{
				socket.parser.authed = true;
			}

			this._receivers[reqInfo.dstPort] = socket;
			socket.binding = true;

			// Create local TCP Listening Server
			const tcpServer = createServer();
			socket.dstSock = /** @type {any} */ (tcpServer);
			socket.dstPort = reqInfo.dstPort;

			/**
			 * Handle inbound TCP connection on bound port
			 */
			tcpServer.on('connection', (inboundSocket) =>
			{
				const clientAddr = `${inboundSocket.remoteAddress}:${inboundSocket.remotePort}`;
				console.log(`Inbound TCP connection received on BIND port ${reqInfo.dstPort} from ${clientAddr}`);

				// Forward inbound TCP traffic to control stream or message handler
				inboundSocket.on('data', (chunk) =>
				{
					if(typeof onData === 'function')
					{
						onData(chunk);
					}
				});

				inboundSocket.on('error', (err) =>
				{
					console.error(`Inbound BIND TCP socket error (${clientAddr}):`, err);
				});
			});

			// Handle server-level error
			tcpServer.on('error', (err) =>
			{
				console.error(`TCP Server Error on port ${reqInfo.dstPort}:`, err);
				if(typeof _onProxyError === 'function')
				{
					_onProxyError.call(this, reqInfo.dstPort, err);
				}
			});

			// Cleanup listener when client socket disconnects
			const onClose = () =>
			{
				try
				{
					tcpServer.close();
				} catch(err)
				{
					// Ignore secondary close errors
				}
			};
			socket.on('close', onClose);

			// Start TCP listener
			tcpServer.listen(reqInfo.dstPort, reqInfo.dstAddr || '0.0.0.0', () =>
			{
				socket.binding = false;

				const boundAddress = tcpServer.address();
				const boundPort = typeof boundAddress === 'object' && boundAddress !== null ? boundAddress.port : reqInfo.dstPort;
				const clientIP = socket._socket?.remoteAddress || 'unknown';
				const clientPort = socket._socket?.remotePort || 'unknown';

				console.log(
					`Client ${clientIP}:${clientPort} successfully bound TCP listener on ${reqInfo.dstAddr || '0.0.0.0'}:${boundPort}`
				);

				if(typeof _onSocketConnect === 'function')
				{
					_onSocketConnect.call(this, reqInfo.dstPort, reqInfo);
				}
			});
		} else
		{
			console.warn(`Unsupported command ${reqInfo.cmd} passed to proxyBINDCommand`);
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
			console.error('Request error in BIND execution:', err);
		}
	}
}

// Module Exports
module.exports = {
	proxyBINDCommand,
	CMD
};
