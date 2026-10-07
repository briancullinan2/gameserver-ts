// @ts-check

/**
 * @file modular_socks_proxy.js
 * @description Advanced Quake3 / SOCKS5 / WebSocket Proxy Server for Node.js
 */


/**
 * @typedef {WebSocket | dgram.Socket} ExtendedParameters
 * @property {Parser} parser
 * @property {dgram.Socket} dstSock
 * @property {number} dstPort
 * @property {Socket} _socket
 * @property {Function} send
 * @property {Function} close
 * @property {boolean} binding
 */


/**
 * @typedef {(WebSocket & ExtendedParameters) | (dgram.Socket & ExtendedParameters)} ExtendedSocket
 */

const dgram = require('dgram');
const { createServer, Socket } = require('net');
const dns = require('dns');
const http = require('http');
const ip6addr = require('ip6addr');
const WebSocket = require('ws');
const WebSocketServer = WebSocket.Server;

const Parser = require('./socks.parser');
const Huffman = require('./huffman.js');
const SHOWNET = require('./shownet');

// ============================================================================
// CONSTANTS & CONSTANT DICTIONARIES
// ============================================================================

const UDP_TIMEOUT = 330 * 1000;
const MAX_STRING_CHARS = 8192;
const MAX_PACKETLEN = 1400;
const MAX_MSGLEN = 16384;

/** @type {Array<string | null>} */
const SVC_STRINGS = [
	'svc_bad',
	'svc_nop',
	'svc_gamestate',
	'svc_configstring',
	'svc_baseline',
	'svc_serverCommand',
	'svc_download',
	'svc_snapshot',
	'svc_EOF',
	'svc_voipSpeex',
	'svc_voipOpus',
	null, null, null, null, null,
	'svc_multiview',
	'svc_zcmd'
];

/** @type {string[]} */
const CLC_STRINGS = [
	'clc_bad',
	'clc_nop',
	'clc_move',
	'clc_moveNoDelta',
	'clc_clientCommand',
	'clc_EOF',
	'clc_voipSpeex',
	'clc_voipOpus'
];

const ATYP = Object.freeze({
	IPv4: 0x01,
	NAME: 0x03,
	IPv6: 0x04
});

const REP = Object.freeze({
	SUCCESS: 0x00,
	GENFAIL: 0x01,
	DISALLOW: 0x02,
	NETUNREACH: 0x03,
	HOSTUNREACH: 0x04,
	CONNREFUSED: 0x05,
	TTLEXPIRED: 0x06,
	CMDUNSUPP: 0x07,
	ATYPUNSUPP: 0x08
});

const BUF_AUTH_NO_ACCEPT = Buffer.from([0x05, 0xff]);
const BUF_REP_INTR_SUCCESS = Buffer.from([
	0x05, REP.SUCCESS, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
]);
const BUF_REP_DISALLOW = Buffer.from([0x05, REP.DISALLOW]);
const BUF_REP_CMDUNSUPP = Buffer.from([0x05, REP.CMDUNSUPP]);

// ============================================================================
// HUFFMAN & PROTOCOL ENGINE MODULE
// ============================================================================

/**
 * Handles binary stream unpacking, bit reading, and Huffman compression.
 */
class HuffmanEngine
{
	constructor()
	{
		this.buffer = null;
		this.msgData = null;
		this.msg = null;
		this.sym = null;
		this.initialized = false;

		Huffman.onRuntimeInitialized = () => this.init();
	}

	init()
	{
		Huffman['_MSG_initHuffman']();
		this.buffer = Huffman.allocate(new Int8Array(MAX_PACKETLEN), 1);
		this.msgData = Huffman.allocate(new Int8Array(MAX_MSGLEN), 1);
		this.msg = Huffman.allocate(new Int32Array(40), 1);
		this.sym = Huffman.allocate(new Int32Array(1), 1);

		Huffman.HEAP32[(this.msg >> 2) + 3] = this.msgData;
		Huffman.HEAP32[(this.msg >> 2) + 4] = MAX_MSGLEN;
		this.initialized = true;
	}

	/**
	 * Reads bits from a buffer using the underlying Emscripten Huffman heap.
	 * @param {Uint8Array} msgBuffer
	 * @param {number} offset
	 * @param {number} [bits=8]
	 * @returns {[number, number]} [newBitIndex, value]
	 */
	readBits(msgBuffer, offset, bits = 8)
	{
		let value = 0;
		let nbits = bits & 7;
		let bitIndex = offset;

		msgBuffer.forEach((c, i) =>
		{
			Huffman.HEAP8[this.buffer + i] = c;
		});

		if(nbits)
		{
			for(let i = 0; i < nbits; i++)
			{
				value |= Huffman._HuffmanGetBit(this.buffer, bitIndex) << i;
				bitIndex++;
			}
			bits -= nbits;
		}

		if(bits)
		{
			for(let i = 0; i < bits; i += 8)
			{
				bitIndex += Huffman._HuffmanGetSymbol(this.sym, this.buffer, bitIndex);
				value |= Huffman.getValue(this.sym) << (i + nbits);
			}
		}
		return [bitIndex, value];
	}

	/**
	 * Decompresses an incoming Huffman-encoded payload.
	 * @param {Buffer} message
	 * @param {number} offset
	 * @returns {Buffer}
	 */
	decompressMessage(message, offset)
	{
		message.forEach((c, i) =>
		{
			Huffman.HEAP8[this.msgData + i] = c;
		});
		Huffman.HEAP32[(this.msg >> 2) + 5] = message.length;
		Huffman._Huff_Decompress(this.msg, 12);
		return Huffman.HEAP8.slice(
			this.msgData + offset,
			this.msgData + Huffman.HEAP32[(this.msg >> 2) + 5]
		);
	}
}

const huffmanEngine = new HuffmanEngine();

// ============================================================================
// PROTOCOL HELPERS
// ============================================================================

/**
 * Protocol Utility Helpers for Quake3 Networking
 */
class QuakeProtocol
{
	/**
	 * Generates a checksum for network channel validation.
	 * @param {number} challenge
	 * @param {number} sequence
	 * @returns {number}
	 */
	static netchanGenChecksum(challenge, sequence)
	{
		return challenge ^ (sequence * challenge);
	}

	/**
	 * Reads a string from bitstream array.
	 * @param {[number]} readPointer
	 * @param {Uint8Array} message
	 * @returns {[number, string]}
	 */
	static readString(readPointer, message)
	{
		let result = '';
		let currentRead = readPointer;
		do
		{
			const [nextBitIndex, c] = huffmanEngine.readBits(message, currentRead[0], 8);
			currentRead[0] = nextBitIndex;

			if(c <= 0 || result.length >= MAX_STRING_CHARS - 1)
			{
				break;
			}

			let charStr = c === 37 || c > 127 ? '.' : String.fromCharCode(c);
			result += charStr;
		} while(true);

		return [currentRead[0], result];
	}

}

// ============================================================================
// MAIN SERVER MODULE
// ============================================================================

/**
 * @typedef {Object} ServerOptions
 * @property {string} [proxy] Primary forwarding IP address.
 */

/**
 * @typedef {Object} RequestInfo
 * @property {number} cmd
 * @property {string} dstAddr
 * @property {number} dstPort
 * @property {string} [srcAddr]
 * @property {number} [srcPort]
 * @property {Buffer} [data]
 */

class Server
{
	/**
	 * @param {ServerOptions} [opts]
	 */
	constructor(opts = {})
	{
		this._forwardIP = opts.proxy || '';
		/** @type {Record<number, ExtendedSocket>} */
		this._listeners = {};
		/** @type {Record<number, http.Server>} */
		this._httpServers = {};
		/** @type {Record<number, ExtendedSocket>} */
		this._receivers = {};
		/** @type {Record<string, WebSocket>} */
		this._directConnects = {};
		/** @type {Record<number, number>} */
		this._timeouts = {};
		/** @type {Record<string, string>} */
		this._dnsLookup = {};
		this._debug = true;
		/** @type {Array<any>} */
		this._auths = [];
		this._connections = 0;
		this.maxConnections = Infinity;

		this._initTimers();
		this._bindProcessHandlers();
	}

	_initTimers()
	{
		setInterval(() =>
		{
			const now = Date.now();
			Object.keys(this._timeouts).forEach(k =>
			{
				const portKey = Number(k);
				if(this._timeouts[portKey] < now - UDP_TIMEOUT)
				{
					this._timeoutUDP(portKey);
				}
			});
		}, 100);
	}

	_bindProcessHandlers()
	{
		process.on('uncaughtException', this._onErrorNoop);
		process.on('unhandledRejection', this._onErrorNoop);
	}

	/**
	 * @param {Error & { code?: string }} err
	 */
	_onErrorNoop(err)
	{
		if(err && err.code && !err.code.includes('EADDRINUSE'))
		{
			console.log(err);
		}
	}

	/**
	 * Resolve hostnames into sanitized IPv4/IPv6 strings.
	 * @param {string} address
	 * @returns {Promise<string>}
	 */
	async lookupDNS(address)
	{
		if(this._dnsLookup[address] !== undefined)
		{
			return this._dnsLookup[address];
		}
		return new Promise((resolve, reject) =>
		{
			dns.lookup(address, (err, dstIP) =>
			{
				if(err) return reject(err);
				const cleanIP = dstIP.replace('::ffff:', '');
				if(address.localeCompare(dstIP, 'en', { sensitivity: 'base' }) > 0)
				{
					console.log(`DNS found ${address} -> ${cleanIP}`);
					this._dnsLookup[address] = cleanIP;
				}
				return resolve(cleanIP);
			});
		});
	}

	/**
	 * Attach connection auth provider.
	 * @param {any} auth
	 */
	useAuth(auth)
	{
		if(
			typeof auth !== 'object' ||
			typeof auth.server !== 'function' ||
			auth.server.length !== 2
		)
		{
			throw new Error('Invalid authentication handler');
		}
		if(this._auths.length >= 255)
		{
			throw new Error('Too many authentication handlers (limited to 255).');
		}
		this._auths.push(auth);
		return this;
	}

	/**
	 * Inbound Connection Handler (Net/WebSocket)
	 * @param {ExtendedSocket} socket
	 */
	_onConnection(socket)
	{
		++this._connections;
		const parser = new Parser(socket);

		const onData = parser._onData.bind(parser);
		const onEnd = parser._onData.bind(parser, null);
		const onError = this._onParseError.bind(this, socket, onData, onEnd);
		const onMethods = this._onMethods.bind(this, parser, socket, onData, onEnd);
		const onRequest = this._onRequest.bind(this, socket, onData, onEnd);
		const onClose = this._onClose.bind(this, socket, onData, onEnd);

		if(socket instanceof WebSocket)
		{
			const remoteAddr = `${socket._socket.remoteAddress}:${socket._socket.remotePort}`;
			console.log(`Websocket connection ${remoteAddr}....`);
			socket.on('message', onData);
			socket._socket.setTimeout(0);
			socket._socket.setNoDelay(true);
			socket._socket.setKeepAlive(true);
		} else if(socket instanceof Socket)
		{
			console.log(`Net socket connection ${socket.remoteAddress}:${socket.remotePort}....`);
			socket.on('data', onData);
			socket.setTimeout(0);
			socket.setNoDelay(true);
			socket.setKeepAlive(true);
			socket.send = socket.write;
			socket._socket = socket;
			socket.close = socket.end;
		} else
		{
			console.log('Socket type unknown!');
			if(typeof socket.close === 'function') socket.close();
			return;
		}

		parser
			.on('error', onError)
			.on('ping', () =>
			{
				const port = Object.keys(this._listeners).find(
					k => this._listeners[Number(k)] === socket.dstSock
				);
				if(port)
				{
					this._timeouts[Number(port)] = Date.now();
				}
				socket.send(Buffer.from([0x05, 0x00]), { binary: true });
			})
			.on('methods', onMethods)
			.on('request', onRequest);

		socket.parser = parser;
		socket.on('error', this._onErrorNoop).on('close', onClose);
	}

	/**
	 *
	 * @param {ExtendedSocket} socket
	 * @param {(msg: string) => void} onData
	 * @param {(msg: string) => void} onEnd
	 */
	_onClose(socket, onData, onEnd)
	{
		if(socket._socket)
		{
			console.error('Closing ', socket._socket.remoteAddress, ':', socket._socket.remotePort);
		}
		socket.off('data', onData);
		socket.off('message', onData);
	}

	/**
	 *
	 * @param {ExtendedSocket} socket
	 * @param {(msg: string) => void} onData
	 * @param {(msg: string) => void} onEnd
	 * @param {Error} err
	 */
	_onParseError(socket, onData, onEnd, err)
	{
		console.log('Parse error ', err);
		socket.off('data', onData);
		socket.off('message', onData);
		if(typeof socket.close === 'function') socket.close();
	}

	/**
	 *
	 * @param {Parser} parser
	 * @param {ExtendedSocket} socket
	 * @param {(msg: string) => void} onData
	 * @param {(msg: string) => void} onEnd
	 * @param {DataView} methods
	 */
	_onMethods(parser, socket, onData, onEnd, methods)
	{
		parser.authed = true;
		socket.off('data', onData);
		socket.off('message', onData);
		socket.send(Buffer.from([0x05, 0x00]), { binary: true });
		if(socket._socket && socket._socket.resume) socket._socket.resume();
		socket.on('data', onData);
		socket.on('message', onData);
	}

	/**
	 * Process Request
	 * @param {any} socket
	 * @param {Function} onData
	 * @param {Function} onEnd
	 * @param {RequestInfo} reqInfo
	 */
	async _onRequest(socket, onData, onEnd, reqInfo)
	{
		reqInfo.srcAddr = socket._socket.remoteAddress;
		reqInfo.srcPort = socket._socket.remotePort;

		if(socket._socket.resume) socket._socket.resume();
		await this.proxyCommand(socket, reqInfo, onData);
	}

	/**
	 * Main Proxy Command Executor
	 * @param {ExtendedSocket} socket
	 * @param {RequestInfo} reqInfo
	 * @param {Function} onData
	 */
	async proxyCommand(socket, reqInfo, onData)
	{
		let dstIP;
		try
		{
			dstIP = await this.lookupDNS(reqInfo.dstAddr || '0.0.0.0');
		} catch(e)
		{
			console.log('DNS error:', e);
			return;
		}

		console.log(reqInfo, dstIP);

		try
		{
			const remoteAddr = `${dstIP}:${reqInfo.dstPort}`;

			if(reqInfo.cmd === Parser.CMD.UDP)
			{
				const onClose = () =>
				{
					if(socket.dstSock)
					{
						socket.dstSock.off('close', onClose);
						delete socket.dstSock;
					}
					socket.close();
				};

				socket.parser.authed = true;
				socket.binding = true;
				this._receivers[reqInfo.dstPort] = socket;
				/** @type {any} */
				const addr = socket.dstSock?.address();
				if(
					!this._listeners[reqInfo.dstPort] ||
					this._listeners[reqInfo.dstPort].readyState > 1
				)
				{
					await this.tryBindPort(reqInfo);
					socket.dstSock = this._listeners[reqInfo.dstPort];
					socket.dstPort = reqInfo.dstPort;
					socket.dstSock?.on('close', onClose);


					await this.websockify(reqInfo, addr?.port);
					this._onSocketConnect(reqInfo.dstPort, reqInfo);
				} else if(reqInfo.dstPort && !socket.dstSock)
				{
					socket.dstSock = this._listeners[reqInfo.dstPort];
					socket.dstPort = reqInfo.dstPort;
					socket.dstSock?.on('close', onClose);
					this._onSocketConnect(reqInfo.dstPort, reqInfo);
				}

				console.log(
					`${socket._socket.remoteAddress}:${socket._socket.remotePort}`,
					'Switching to UDP listener',
					reqInfo.dstPort,
					'->',
					addr?.port
				);
				socket.binding = false;
			} else if(reqInfo.cmd === Parser.CMD.BIND)
			{
				socket.parser.authed = true;
				this._receivers[reqInfo.dstPort] = socket;
				socket.binding = true;
				socket.dstSock = createServer();
				socket.dstPort = reqInfo.dstPort;

				socket.dstSock
					.on('connection', () => { })
					.on('error', this._onProxyError.bind(this, reqInfo.dstPort))
					.listen(reqInfo.dstPort, reqInfo.dstAddr, () =>
					{
						socket.binding = false;
						this._onSocketConnect(reqInfo.dstPort, reqInfo);
					});

				console.log(
					`${socket._socket.remoteAddress}:${socket._socket.remotePort}`,
					'Binding TCP listener',
					reqInfo.dstPort,
					'->',
					socket.dstSock?.address().port
				);
			} else if(reqInfo.cmd === Parser.CMD.CONNECT)
			{
				if(socket.binding)
				{
					let waitingCount = 0;
					await new Promise(resolve =>
					{
						const waiting = setInterval(() =>
						{
							if(!socket.binding || waitingCount > 1000)
							{
								clearInterval(waiting);
								resolve(null);
							} else
							{
								waitingCount++;
							}
						}, 10);
					});
				}

				if(socket.dstSock)
				{
					SHOWNET(reqInfo.data, socket, true);
					socket.dstSock.send(
						reqInfo.data,
						0,
						reqInfo.data?.length,
						reqInfo.dstPort,
						dstIP
					);
					this._timeouts[socket.dstPort || reqInfo.srcPort] = Date.now();
				} else
				{
					console.log(
						`${socket._socket.remoteAddress}:${socket._socket.remotePort}`,
						'TCP connection to ',
						reqInfo.dstAddr,
						reqInfo.dstPort
					);
					/** @type {ExtendedSocket} */
					const dstSock = new Socket();
					this._receivers[socket._socket.remotePort] = socket;
					socket.dstSock = dstSock;
					socket.dstPort = reqInfo.dstPort;

					dstSock.setTimeout(0);
					dstSock.setNoDelay(true);
					dstSock.setKeepAlive(true);
					dstSock.send = dstSock.write;
					dstSock._socket = dstSock;
					dstSock.close = dstSock.end;

					socket._socket.pause();
					dstSock
						.on('error', this._onErrorNoop)
						.on('end', () =>
						{
							socket._socket.pause();
							socket.unpipe(socket.dstSock);
							socket.on('data', onData);
							socket._socket.resume();
						})
						.on('connect', () =>
						{
							this._onUDPMessage(socket._socket.remotePort, false, true, {
								address: socket._socket.localAddress,
								port: dstSock.address().port
							});
							socket.off('data', onData);
							socket._socket.pipe(socket.dstSock);
							socket.dstSock.pipe(socket._socket);
							socket._socket.resume();
						})
						.connect(reqInfo.dstPort, dstIP);
				}
			} else if(reqInfo.cmd === Parser.CMD.WS)
			{
				const port = socket.dstPort || reqInfo.srcPort;
				const onForward = msg =>
				{
					this._directConnects[remoteAddr]._message(Buffer.from(msg), {
						address: dstIP,
						port: reqInfo.dstPort
					});
				};
				const realPort = socket.dstSock ? socket.dstSock.address().port : null;

				this._receivers[port] = socket;
				SHOWNET(reqInfo.data, socket, false, true);
				await this.websocketRequest(
					this._onProxyError.bind(this, port),
					this._onUDPMessage.bind(this, port, true),
					onForward,
					reqInfo,
					dstIP,
					realPort
				);

				socket.on('close', () =>
				{
					if(
						this._directConnects[remoteAddr] &&
						this._directConnects[remoteAddr].readyState === 1
					)
					{
						this._directConnects[remoteAddr].off('message', onForward);
						this._directConnects[remoteAddr].close();
						delete this._directConnects[remoteAddr];
					}
				});
			} else
			{
				console.error('command unsupported');
				socket.send(BUF_REP_CMDUNSUPP, { binary: true });
				socket.close();
			}
		} catch(err)
		{
			if(err.code && err.code.includes('ERR_SOCKET_DGRAM_NOT_RUNNING'))
			{
				socket.close();
			} else
			{
				console.log('Request error:', err);
			}
		}
	}

	/**
	 * Binds a local dynamic UDP listener.
	 * @param {RequestInfo} reqInfo
	 */
	async tryBindPort(reqInfo)
	{
		const onUDPMessage = this._onUDPMessage.bind(this, reqInfo.dstPort, false);

		for(let i = 0; i < 10; i++)
		{
			try
			{
				const portLeft = Math.round(Math.random() * 50) * 1000 + 5000;
				const portRight = reqInfo.dstPort & 0xfff;
				const listener = dgram.createSocket('udp4');

				await new Promise((resolve, reject) =>
					listener
						.on('listening', resolve)
						.on('close', () =>
						{
							delete this._listeners[reqInfo.dstPort];
							delete this._timeouts[reqInfo.dstPort];
						})
						.on('error', reject)
						.on('message', onUDPMessage)
						// Bind explicitly to 127.0.0.1 for local master loops if needed
						.bind(portLeft + portRight, reqInfo.dstAddr || '0.0.0.0')
				);

				console.log(
					'Starting listener ',
					reqInfo.dstPort,
					' -> ',
					portLeft + portRight
				);
				this._listeners[reqInfo.dstPort] = listener;
				this._timeouts[reqInfo.dstPort] = Date.now();
				return listener;
			} catch(e)
			{
				if(!e.code.includes('EADDRINUSE')) throw e;
			}
		}
		throw new Error('Failed to start UDP listener.');
	}

	/**
	 * Bridge standard UDP messages into WebSockets.
	 * @param {RequestInfo} reqInfo
	 * @param {number} realPort
	 */
	async websockify(reqInfo, realPort)
	{
		if(this._httpServers[realPort] !== undefined) return;

		const onUDPMessage = this._onUDPMessage.bind(this, reqInfo.dstPort, true);
		const httpServer = http.createServer();
		const wss = new WebSocketServer({ server: httpServer });

		wss.on('connection', async (ws, req) =>
		{
			const dstIP = await this.lookupDNS(req.socket.remoteAddress || '0.0.0.0');
			const remoteAddr = `${dstIP}:${req.socket.remotePort}`;
			console.log(`Direct connect from ${remoteAddr}`);

			ws.on('message', msg =>
				onUDPMessage(Buffer.from(msg), {
					address: dstIP,
					port: req.socket.remotePort
				})
			)
				.on('error', this._onErrorNoop)
				.on('close', () => delete this._directConnects[remoteAddr]);

			this._directConnects[remoteAddr] = ws;
		});

		this._listeners[reqInfo.dstPort].on('close', () => wss.close());

		await new Promise(resolve =>
		{
			try
			{
				httpServer.on('error', this._onErrorNoop);
				httpServer.listen(realPort, reqInfo.dstAddr, resolve);
				this._httpServers[realPort] = httpServer;
			} catch(e)
			{
				console.log(e.message);
			}
			resolve(null);
		});
	}

	/**
	 * Handle active outbound WebSocket requests.
	 */
	/**
	 *
	 * @param {(err: Error) => void} onError
	 * @param {(message: ArrayBuffer) => void} onUDPMessage
	 * @param {(message: ArrayBuffer) => void} onForward
	 * @param {RequestInfo} reqInfo
	 * @param {string} dstIP
	 * @param {number} realPort
	 */
	async websocketRequest(
		onError,
		onUDPMessage,
		onForward,
		reqInfo,
		dstIP,
		realPort
	)
	{
		const remoteAddr = `${dstIP}:${reqInfo.dstPort}`;

		if(
			!this._directConnects[remoteAddr] ||
			this._directConnects[remoteAddr].readyState > 1
		)
		{
			console.log(`Websocket (bound ${realPort}) request ${remoteAddr}`);

			/** @type {({headers: Record<string, string>})} */
			const options = { headers: {} };
			if(realPort) options.headers['x-forwarded-port'] = '' + realPort;
			if(this._forwardIP && this._forwardIP.length > 0)
			{
				options.headers['x-forwarded-for'] = this._forwardIP;
			}

			/** @type {ExtendedSocket} */
			const ws = new WebSocket(`ws://${remoteAddr}`, options);
			this._directConnects[remoteAddr] = ws;

			ws.on('message', onForward)
				.on('error', err => ws._error(err))
				.on('open', () =>
				{
					if(ws._pending)
					{
						ws._pending.forEach(d => ws.send(d, { binary: true }));
					}
				})
				.on('close', () => delete this._directConnects[remoteAddr]);

			ws._pending = [reqInfo.data];
		} else if(this._directConnects[remoteAddr].readyState !== 1)
		{
			this._directConnects[remoteAddr]._pending.push(reqInfo.data);
		} else
		{
			this._directConnects[remoteAddr].send(reqInfo.data, { binary: true });
		}

		this._directConnects[remoteAddr]._message = onUDPMessage;
		this._directConnects[remoteAddr]._error = onError;
	}

	/**
	 *
	 * @param {number} udpLookupPort
	 * @param {boolean} isWebSocket
	 * @param {boolean | ArrayBuffer} message
	 * @param {dgram.RemoteInfo} rinfo
	 * @returns
	 */
	_onUDPMessage(udpLookupPort, isWebSocket, message, rinfo)
	{
		const socket = this._receivers[udpLookupPort];
		if(!socket) return;

		let returnIP = false;
		const ipv6 = ip6addr.parse(rinfo.address);
		let localbytes = ipv6.toBuffer();

		if(ipv6.kind() === 'ipv4')
		{
			localbytes = localbytes.slice(12);
		}

		let domain = Object.keys(this._dnsLookup).find(
			n => this._dnsLookup[n] === rinfo.address
		);

		if(domain && isWebSocket)
		{
			domain = `ws://${domain}`;
		}

		const bufrep =
			returnIP || !domain
				? Buffer.alloc(4 + localbytes.length + 2)
				: Buffer.alloc(4 + 1 + domain.length + 1 + 2);

		bufrep[0] = 0x05;
		bufrep[1] = message === true ? REP.SUCCESS : 0x00;
		bufrep[2] = 0x00;

		if(returnIP || !domain)
		{
			bufrep[3] = isWebSocket ? 0x04 : 0x01;
			for(let i = 0, p = 4; i < localbytes.length; ++i, ++p)
			{
				bufrep[p] = localbytes[i];
			}
			bufrep.writeUInt16LE(rinfo.port, 8);
		} else
		{
			bufrep[3] = 0x03;
			bufrep[4] = domain.length + 1;
			bufrep.write(domain, 5);
			bufrep.writeUInt16LE(rinfo.port, 5 + bufrep[4]);
		}

		SHOWNET(message, socket, false);

		socket.send(
			message === true ? bufrep : Buffer.concat([bufrep, message]),
			{ binary: true }
		);
		this._timeouts[udpLookupPort] = Date.now();
	}

	/**
	 *
	 * @param {number} udpLookupPort
	 */
	_timeoutUDP(udpLookupPort)
	{
		if(this._listeners[udpLookupPort] !== undefined)
		{
			console.error('socket timeout');
			this._listeners[udpLookupPort].close();
			delete this._listeners[udpLookupPort];
			delete this._timeouts[udpLookupPort];
		}
	}

	/**
	 *
	 * @param {number} udpLookupPort
	 * @param {RequestInfo} reqInfo
	 * @returns
	 */
	_onSocketConnect(udpLookupPort, reqInfo)
	{
		const socket = this._receivers[udpLookupPort];
		if(!socket || !socket._socket.writable) return;

		const targetAddr =
			socket._socket.localAddress === '::1'
				? '127.0.0.1'
				: socket._socket.localAddress;

		const ipv6 = ip6addr.parse(targetAddr);
		let localbytes = ipv6.toBuffer();

		if(ipv6.kind() === 'ipv4')
		{
			localbytes = localbytes.slice(12);
		}

		const bufrep = Buffer.alloc(6 + localbytes.length);
		bufrep[0] = 0x05;
		bufrep[1] = REP.SUCCESS;
		bufrep[2] = 0x00;
		bufrep[3] = ipv6.kind() === 'ipv4' ? ATYP.IPv4 : ATYP.IPv6;

		let p = 4;
		for(let i = 0; i < localbytes.length; ++i, ++p)
		{
			bufrep[p] = localbytes[i];
		}

		bufrep.writeUInt16LE(socket._socket.localPort, p);
		socket.send(bufrep, { binary: true });

		if(typeof socket.dstSock === 'function')
		{
			console.log('Starting pipe');
			socket._socket.pipe(socket.dstSock);
			socket.dstSock.pipe(socket._socket);
		} else
		{
			console.log('Starting messages ' + ipv6.kind(), socket._socket.localPort);
		}
	}

	/**
	 *
	 * @param {number} udpLookupPort
	 * @param {Error | any} err
	 * @returns
	 */
	_onProxyError(udpLookupPort, err)
	{
		const socket = this._receivers[udpLookupPort];
		console.log(err);
		if(!socket || !socket._socket.writable) return;

		const errbuf = Buffer.from([0x05, REP.GENFAIL]);
		if(err.code)
		{
			switch(err.code)
			{
				case 'ENOENT':
				case 'ENOTFOUND':
				case 'ETIMEDOUT':
				case 'EHOSTUNREACH':
					errbuf[1] = REP.HOSTUNREACH;
					break;
				case 'ENETUNREACH':
					errbuf[1] = REP.NETUNREACH;
					break;
				case 'ECONNREFUSED':
					errbuf[1] = REP.CONNREFUSED;
					break;
			}
		}
		socket.send(errbuf, { binary: true });
	}
}

// Module Exports
module.exports = {
	Server,
	HuffmanEngine,
	QuakeProtocol,
	SVC_STRINGS,
	CLC_STRINGS
};
