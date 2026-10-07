// @ts-check

/**
 * @file proxy_connect.js
 * @description SOCKS5 Command 0x01 (CONNECT) Handler for outbound TCP/UDP stream creation
 */

const { Socket } = require('net');
const { _onUDPMessage } = require('./socks.0.js');

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

/**
 * Helper delay function replacing setInterval loops
 * @param {number} ms
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// MODULAR PROXY CONNECT FUNCTION
// ============================================================================

/**
 * Executes SOCKS5 CONNECT (0x01) logic. Handles outbound socket creation,
 * payload forwarding, and stream piping.
 * Expects execution context (`this`) to be bound to the `Server` instance.
 *
 * @this {Server}
 * @param {ExtendedSocket} socket Client control socket requesting CONNECT.
 * @param {RequestInfo} reqInfo Decoded SOCKS request metadata.
 * @param {(data: string | NonSharedBuffer) => void} onData Incoming raw data handler callback.
 * @returns {Promise<void>}
 */
async function proxyCONNECTCommand(socket, reqInfo, onData)
{


	const remoteAddr = `${reqInfo.dstIP}:${reqInfo.dstPort}`;
	console.log(`Received SOCKS5 CONNECT request for ${remoteAddr}`);

	try
	{
		if(reqInfo.cmd === CMD.CONNECT)
		{
			// Non-blocking spin-wait if socket is currently binding a listener
			if(socket.binding)
			{
				let waitingCount = 0;
				while(socket.binding && waitingCount < 1000)
				{
					await sleep(10);
					waitingCount++;
				}
			}

			// Payload already has an assigned target socket (e.g. UDP forwarding context)
			if(socket.dstSock)
			{
				// Send via dgram UDP send or TCP write depending on destination socket type
				if(typeof (/** @type {any} */ (socket.dstSock).send) === 'function')
				{
						/** @type {any} */ (socket.dstSock).send(
					reqInfo.data,
					0,
					reqInfo.data?.length,
					reqInfo.dstPort,
					reqInfo.dstIP
				);
				} else if(socket.dstSock instanceof Socket
					&& typeof socket.dstSock.write === 'function'
					&& reqInfo.data)
				{
					socket.dstSock.write(reqInfo.data);
				}

				const fallbackPort = socket._socket?.remotePort || reqInfo.srcPort || 0;
				this._timeouts[socket.dstPort || fallbackPort] = Date.now();
			} else
			{
				const remotePort = socket._socket?.remotePort || 'unknown';
				const remoteHost = socket._socket?.remoteAddress || 'unknown';

				console.log(`Opening outbound TCP socket from ${remoteHost}:${remotePort} -> ${reqInfo.dstAddr}:${reqInfo.dstPort}`);

				/** @type {ExtendedSocket & Socket} */
				const dstSock = new Socket();

				if(socket._socket?.remotePort)
				{
					this._receivers[socket._socket.remotePort] = socket;
				}

				socket.dstSock = dstSock;
				socket.dstPort = reqInfo.dstPort;

				dstSock.setTimeout(0);
				dstSock.setNoDelay(true);
				dstSock.setKeepAlive(true);

				// Normalize socket interface
				dstSock.send = (/** @type {Uint8Array<ArrayBufferLike>} */ data, /** @type {(err?: Error | null) => void} */ cb) => dstSock.write(data, cb);
				dstSock._socket = dstSock;
				dstSock.close = () => dstSock.end();

				if(socket._socket && typeof socket._socket.pause === 'function')
				{
					socket._socket.pause();
				}

				dstSock
					.on('error', (/** @type {Error} */err) =>
					{
						if(typeof this._onErrorNoop === 'function')
						{
							this._onErrorNoop(err);
						}
					})
					.on('end', () =>
					{
						if(socket instanceof Socket && socket._socket
							&& socket._socket instanceof Socket
						)
						{
							if(typeof socket._socket.pause === 'function') socket._socket.pause();
							if(typeof socket.unpipe === 'function' && socket.dstSock instanceof Socket) socket.unpipe(socket.dstSock);
							if(onData) socket.on('data', onData);
							if(typeof socket._socket.resume === 'function') socket._socket.resume();
						}
					})
					.on('connect', () =>
					{
						const rawAddress = dstSock.address();
						const boundPort = typeof rawAddress === 'object' && rawAddress !== null && 'port' in rawAddress ? rawAddress.port : reqInfo.dstPort;

						if(socket._socket?.remotePort && typeof (_onUDPMessage) === 'function')
						{
							_onUDPMessage.call(this, socket._socket.remotePort, false, true, {
								address: socket._socket.localAddress ?? '',
								port: boundPort,
								family: socket._socket.localFamily === 'IPv6' ? 'IPv6' : 'IPv4',
								size: socket._socket.bufferSize
							});
						}

						if(socket instanceof Socket && onData)
						{
							socket.off('data', onData);
						}

						// Establish full-duplex piping for Net sockets
						if(socket._socket && typeof socket._socket.pipe === 'function')
						{
							socket._socket.pipe(dstSock);
							dstSock.pipe(socket._socket);
							socket._socket.resume();
						}
					})
					.connect(/** @type {number} */ reqInfo.dstPort, reqInfo.dstIP ?? '');
			}
		} else
		{
			console.warn(`Unsupported command ${reqInfo.cmd} passed to proxyCONNECTCommand`);
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
			console.error('Request error in CONNECT execution:', err);
		}
	}
}

// Module Exports
module.exports = {
	proxyCONNECTCommand,
	CMD
};
