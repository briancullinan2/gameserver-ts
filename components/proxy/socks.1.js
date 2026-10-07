// @ts-check

/**
 * @file proxy_udp.js
 * @description SOCKS5 UDP Associate / Binding & HTTP WebSocket Multiplex Bridge
 */

const dgram = require('dgram');
const http = require('http');
const WebSocket = require('ws');
const { _onSocketConnect, _onUDPMessage } = require('./socks.0.js');
const WebSocketServer = WebSocket.Server;

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

// Import Logger or fallback to console
const Logger = require('./socks.0.js').Logger || console;

// ============================================================================
// MODULAR PROXY UDP FUNCTIONS
// ============================================================================

/**
 * Executes SOCKS5 UDP Associate / UDP Bind logic.
 * Expects execution context (`this`) to be bound to the `Server` instance.
 *
 * @this {Server}
 * @param {ExtendedSocket} socket Client control socket requesting UDP association.
 * @param {RequestInfo} reqInfo Decoded SOCKS request parameters.
 * @param {Function} [onData] Optional incoming raw data callback.
 * @returns {Promise<void>}
 */
async function proxyUDPCommand(socket, reqInfo, onData)
{
	const remoteAddr = `${reqInfo.dstIP}:${reqInfo.dstPort}`;
	const lookupPort = reqInfo.dstPort ?? socket._socket?.remotePort;

	console.log(`Processing UDP command request for ${remoteAddr} (Lookup Port: ${lookupPort})`);

	try
	{
		if(reqInfo.cmd === CMD.UDP)
		{
			/**
			 * Teardown listener when control socket closes
			 */
			const onClose = () =>
			{
				if(socket.dstSock)
				{
					socket.dstSock.off('close', onClose);
					delete socket.dstSock;
				}
				if(typeof socket.close === 'function')
				{
					socket.close();
				}
			};

			if(socket.parser)
			{
				socket.parser.authed = true;
			}
			socket.binding = true;

			// Register receiver lookup using the socket's control port to prevent collisions
			this._receivers[lookupPort] = socket;

			// Ensure listener exists or recreate if socket state is terminated
			if(
				!this._listeners[lookupPort] ||
                /** @type {any} */ (this._listeners[lookupPort]).readyState > 1
			)
			{
				await tryBindPort.call(this, reqInfo, lookupPort);
				socket.dstSock = this._listeners[lookupPort];
				socket.dstPort = reqInfo.dstPort;

				if(socket.dstSock)
				{
					socket.dstSock.on('close', onClose);
				}

				const boundAddress = socket.dstSock instanceof dgram.Socket ? socket.dstSock?.address() : undefined;
				const actualPort = typeof boundAddress === 'object' && boundAddress !== null ? boundAddress.port : reqInfo.dstPort;

				// Spin up HTTP/WebSocket bridge on the dedicated control socket port (prevents EADDRINUSE conflict with UDP)
				await websockify.call(this, reqInfo, lookupPort);

				// Send the 10-byte SOCKS5 UDP Associate response back to the client
				if(typeof _onSocketConnect === 'function')
				{
					_onSocketConnect.call(this, lookupPort, reqInfo);
				}
			} else if(lookupPort && !socket.dstSock)
			{
				socket.dstSock = this._listeners[lookupPort];
				socket.dstPort = reqInfo.dstPort;
				if(socket.dstSock)
				{
					socket.dstSock.on('close', onClose);
				}

				if(typeof _onSocketConnect === 'function')
				{
					_onSocketConnect.call(this, lookupPort, reqInfo);
				}
			}

			const clientIP = socket._socket?.remoteAddress || 'unknown';
			const clientPort = socket._socket?.remotePort || 'unknown';
			const boundAddress = socket.dstSock instanceof dgram.Socket ? socket.dstSock?.address() : undefined;
			const boundPort = typeof boundAddress === 'object' && boundAddress !== null ? boundAddress.port : 'unknown';

			console.log(
				`${clientIP}:${clientPort} -> Switched to UDP listener target ${reqInfo.dstPort} (Local bound port: ${boundPort})`
			);

			socket.binding = false;
		} else
		{
			console.warn(`Unsupported command ${reqInfo.cmd} passed to proxyUDPCommand`);
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
			console.error('Error executing UDP Command:', err);
		}
	}
}

/**
 * Binds a local dynamic UDP listener socket with retry fallbacks.
 * Expects execution context (`this`) to be bound to the `Server` instance.
 *
 * @this {Server}
 * @param {RequestInfo} reqInfo Decoded SOCKS request parameters.
 * @param {number} lookupPort Target receiver mapping port.
 * @returns {Promise<dgram.Socket>} Bound datagram socket.
 */
async function tryBindPort(reqInfo, lookupPort)
{
	const onUDPMessage = typeof _onUDPMessage === 'function'
		? _onUDPMessage.bind(this, lookupPort, false)
		: () => { };

	for(let i = 0; i < 10; i++)
	{
		try
		{
			const portLeft = Math.round(Math.random() * 50) * 1000 + 5000;
			const portRight = reqInfo.dstPort & 0xfff;
			const targetBindPort = portLeft + portRight;
			const listener = dgram.createSocket('udp4');

			await new Promise((resolve, reject) =>
			{
				listener
					.on('listening', resolve)
					.on('close', () =>
					{
						delete this._listeners[lookupPort];
						delete this._timeouts[lookupPort];
					})
					.on('error', reject)
					.on('message', onUDPMessage)
					.bind(targetBindPort, reqInfo.dstAddr || '0.0.0.0');
			});

			console.log(`Started UDP listener mapping: SOCKS requested ${reqInfo.dstPort} -> Bound local ${targetBindPort}`);

            /** @type {any} */ (this._listeners)[lookupPort] = listener;
			this._timeouts[lookupPort] = Date.now();
			return listener;
		} catch(e)
		{
			if(!/** @type {any} */ (e)?.code?.includes('EADDRINUSE'))
			{
				throw e;
			}
		}
	}
	throw new Error(`Failed to bind a free local UDP listener after 10 attempts for target port ${reqInfo.dstPort}`);
}

/**
 * Bridges incoming HTTP / WebSocket client connections directly into the native UDP pipeline.
 *
 * @this {Server}
 * @param {RequestInfo} reqInfo
 * @param {number} bridgePort HTTP listener port.
 * @returns {Promise<void>}
 */
async function websockify(reqInfo, bridgePort)
{
	if(this._httpServers[bridgePort] !== undefined)
	{
		return;
	}

	const onUDPMessage = typeof _onUDPMessage === 'function'
		? _onUDPMessage.bind(this, bridgePort, true)
		: () => { };

	const httpServer = http.createServer();
	const wss = new WebSocketServer({ server: httpServer });

	wss.on('connection', async (ws, req) =>
	{
		const rawRemoteAddress = req.socket.remoteAddress || '0.0.0.0';
		const dstIP = await this.lookupDNS(rawRemoteAddress);
		const remoteAddr = `${dstIP}:${req.socket.remotePort}`;

		console.log(`Direct WebSocket connection established from ${remoteAddr}`);

		ws.on('message', (msg) =>
		{
			const payload = Buffer.isBuffer(msg) ? msg : Buffer.from(/** @type {ArrayBuffer} */(msg));
			onUDPMessage(payload, {
				address: dstIP,
				port: req.socket.remotePort ?? 27960,
				family: req.socket.remoteFamily === 'IPv6' ? 'IPv6' : 'IPv4',
				size: req.socket.bufferSize
			});
		})
			.on('error', (err) =>
			{
				if(typeof this._onErrorNoop === 'function')
				{
					this._onErrorNoop.call(this, err);
				}
			})
			.on('close', () =>
			{
				delete this._directConnects[remoteAddr];
				console.log(`Direct WebSocket disconnected from ${remoteAddr}`);
			});

		this._directConnects[remoteAddr] = ws;
	});

	if(this._listeners[bridgePort])
	{
		this._listeners[bridgePort].on('close', () =>
		{
			try
			{
				wss.close();
				httpServer.close();
			} catch(err)
			{
				console.error('Error terminating websockify HTTP server:', err);
			}
		});
	}

	await new Promise((resolve) =>
	{
		httpServer.on('error', (e) =>
		{
			console.error(`HTTP Bridge error on port ${bridgePort}:`, e.message);
			resolve(null);
		});

		httpServer.listen(bridgePort, reqInfo.dstAddr || '0.0.0.0', () =>
		{
			console.log(`Websockify HTTP/WS bridge listening on ${reqInfo.dstAddr || '0.0.0.0'}:${bridgePort}`);
			this._httpServers[bridgePort] = httpServer;
			resolve(null);
		});
	});
}

// Module Exports
module.exports = {
	proxyUDPCommand,
	tryBindPort,
	websockify,
	CMD
};
