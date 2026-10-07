/// <reference types="node" />
// @ts-check

/**
 * @file modular_socks_proxy.js
 * @description Refactored Quake3 / SOCKS5 / WebSocket Proxy Server with standard logging overrides.
 */

const dgram = require('dgram');
const { createServer, Socket } = require('net');
const dns = require('dns');
const http = require('http');
const ip6addr = require('ip6addr');
const WebSocket = require('ws');

const Parser = require('./socks.parser');
const Huffman = require('./huffman.js');
const SHOWNET = require('./shownet');

const { proxyCommand } = require('./socks.0.js');

// ============================================================================
// CONSTANTS & DICTIONARIES
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
// TYPE ANNOTATIONS & BRIDGE INTERFACES
// ============================================================================

/**
 * Tracks WebSockets directly bridged to native game server sockets.
 * @typedef {Object} BridgeMetadata
 * @property {dgram.Socket} directUDPSocket Dedicated UDP socket bridged to browser WS client.
 * @property {string} targetHost Remote server IP destination.
 * @property {number} targetPort Remote server UDP port destination.
 * @property {boolean} isDirectBridge True if traffic avoids self-loopback binding.
 */

/**
 * Common properties attached across Net, WebSocket, and dgram sockets.
 * @typedef {Object} ExtendedParameters
 * @property {Parser} [parser] SOCKS protocol parser state.
 * @property {dgram.Socket | WebSocket | ExtendedSocket} [dstSock] Direct target socket assigned for execution.
 * @property {number} [dstPort] Port mapping destination.
 * @property {Socket} [_socket] Underlying net.Socket reference (populated on WS instances).
 * @property {(data: Uint8Array<ArrayBufferLike> | Buffer | Uint8Array, opts?: any | Function) => void} [send] Generic stream writer.
 * @property {() => void} [close] Generic close trigger.
 * @property {boolean} [binding] Flag indicating socket binding state.
 * @property {BridgeMetadata} [bridge] WebSocket to Native UDP bridge metadata.
 */

/**
 * @typedef {WebSocket & ExtendedParameters} ExtendedWebSocket
 * @typedef {dgram.Socket & ExtendedParameters} ExtendedDatagramSocket
 * @typedef {Socket & ExtendedParameters} ExtendedNetSocket
 * @typedef {ExtendedWebSocket | ExtendedDatagramSocket | ExtendedNetSocket} ExtendedSocket
 */

/**
 * @typedef {Object} ServerOptions
 * @property {string} [proxy] Primary forwarding IP address.
 * @property {boolean} [debug=true] Enable logging output.
 */

/**
 * @typedef {Object} RequestInfo
 * @property {number} cmd SOCKS5 command requested (e.g., 0x01 CONNECT, 0x03 UDP ASSOCIATE).
 * @property {string} dstAddr
 * @property {string | undefined} dstIP
 * @property {number} dstPort
 * @property {string} [srcAddr]
 * @property {number} [srcPort]
 * @property {Buffer} [data]
 */

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
		/** @type {number | null} */
		this.buffer = null;
		/** @type {number | null} */
		this.msgData = null;
		/** @type {number | null} */
		this.msg = null;
		/** @type {number | null} */
		this.sym = null;
		/** @type {boolean} */
		this.initialized = false;

		if(Huffman && typeof Huffman.onRuntimeInitialized !== 'undefined')
		{
			Huffman.onRuntimeInitialized = () => this.init();
		}
	}

	init()
	{
		try
		{
			Huffman['_MSG_initHuffman']();
			this.buffer = Huffman.allocate(new Int8Array(MAX_PACKETLEN), 1);
			this.msgData = Huffman.allocate(new Int8Array(MAX_MSGLEN), 1);
			this.msg = Huffman.allocate(new Int32Array(40), 1);
			if(!this.msg)
			{
				throw new Error('Failed to allocate a single message for buffer storage.');
			}
			this.sym = Huffman.allocate(new Int32Array(1), 1);

			Huffman.HEAP32[(this.msg >> 2) + 3] = this.msgData;
			Huffman.HEAP32[(this.msg >> 2) + 4] = MAX_MSGLEN;
			this.initialized = true;
			console.log('HuffmanEngine initialized successfully.');
		} catch(err)
		{
			console.error('Failed to initialize HuffmanEngine:', err);
		}
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
		if(!this.initialized || this.buffer === null || this.sym === null)
		{
			throw new Error('HuffmanEngine is not initialized.');
		}

		let value = 0;
		let nbits = bits & 7;
		let bitIndex = offset;

		msgBuffer.forEach((c, i) =>
		{
			Huffman.HEAP8[/** @type {number} */ (this.buffer) + i] = c;
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
		if(!this.initialized || this.msgData === null || this.msg === null)
		{
			throw new Error('HuffmanEngine is not initialized.');
		}

		message.forEach((c, i) =>
		{
			Huffman.HEAP8[/** @type {number} */ (this.msgData) + i] = c;
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

			const charStr = c === 37 || c > 127 ? '.' : String.fromCharCode(c);
			result += charStr;
		} while(true);

		return [currentRead[0], result];
	}
}

// ============================================================================
// MAIN SERVER MODULE
// ============================================================================

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

		//console.setLogging(opts.debug !== false);

		/** @type {Array<any>} */
		this._auths = [];
		this._connections = 0;
		this.maxConnections = Infinity;

		this._initTimers();
		this._bindProcessHandlers();
	}

	/**
	 * Control global console debug logging.
	 * @param {boolean} enable
	 */
	toggleLogging(enable)
	{
		//console.setLogging(enable);
	}

	_initTimers()
	{
		setInterval(() =>
		{
			const now = Date.now();
			Object.keys(this._timeouts).forEach((k) =>
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
		process.on('uncaughtException', (err) => this._onErrorNoop(err));
		process.on('unhandledRejection', (reason) => this._onErrorNoop(reason));
	}

	/**
	 * @param {any} err
	 */
	_onErrorNoop(err)
	{
		if(err && err.code && !err.code.includes('EADDRINUSE'))
		{
			console.error('Server Exception:', err);
		}
	}

	/**
	 * Resolve hostnames into IPv4 strings. Handles direct localhost bypass.
	 * @param {string} address
	 * @returns {Promise<string>}
	 */
	async lookupDNS(address)
	{
		// Intercept localhost to avoid OS IPv6 ::1 dual-stack resolution bugs
		if(address === 'localhost')
		{
			return '127.0.0.1';
		}

		if(this._dnsLookup[address] !== undefined)
		{
			return this._dnsLookup[address];
		}

		return new Promise((resolve, reject) =>
		{
			dns.lookup(address, { family: 4 }, (err, dstIP) =>
			{
				if(err)
				{
					console.error(`DNS lookup failed for ${address}:`, err);
					return reject(err);
				}

				const cleanIP = dstIP.replace('::ffff:', '');
				console.log(`DNS Resolved: ${address} -> ${cleanIP}`);
				this._dnsLookup[address] = cleanIP;
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
			throw new Error('Invalid authentication handler structure');
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
		const onEnd = () => parser._onData(null);
		const onError = (/** @type {Error} */ err) => this._onParseError(socket, onData, onEnd, err);
		const onMethods = (/** @type {DataView} */ methods) => this._onMethods(parser, socket, onData, onEnd, methods);
		const onRequest = (/** @type {RequestInfo} */ reqInfo) => this._onRequest(socket, onData, onEnd, reqInfo);
		const onClose = () => this._onClose(socket, onData, onEnd);

		if(socket instanceof WebSocket)
		{
			const underlyingSocket = socket._socket;
			const remoteAddr = underlyingSocket
				? `${underlyingSocket.remoteAddress}:${underlyingSocket.remotePort}`
				: 'unknown';

			console.log(`WebSocket client connected: ${remoteAddr}`);
			socket.on('message', onData);

			if(underlyingSocket)
			{
				underlyingSocket.setTimeout(0);
				underlyingSocket.setNoDelay(true);
				underlyingSocket.setKeepAlive(true);
			}
		} else if(socket instanceof Socket)
		{
			console.log(`Net TCP connection opened: ${socket.remoteAddress}:${socket.remotePort}`);
			socket.on('data', onData);
			socket.setTimeout(0);
			socket.setNoDelay(true);
			socket.setKeepAlive(true);

			// Uniform Stream Interface Mapping
			socket.send = (data, cb) => socket.write(data, cb);
			socket._socket = socket;
			socket.close = () => socket.end();
		} else
		{
			console.warn('Unknown socket type provided to connection handler!');
			if(typeof socket.close === 'function') socket.close();
			return;
		}

		parser
			.on('error', onError)
			.on('ping', () =>
			{
				const port = Object.keys(this._listeners).find(
					(k) => this._listeners[Number(k)] === socket.dstSock
				);
				if(port)
				{
					this._timeouts[Number(port)] = Date.now();
				}
				if(typeof socket.send === 'function')
				{
					socket.send(Buffer.from([0x05, 0x00]), { binary: true });
				}
			})
			.on('methods', onMethods)
			.on('request', onRequest);

		socket.parser = parser;
		socket.on('error', (err) => this._onErrorNoop(err)).on('close', onClose);
	}

	/**
	 * Handles socket stream teardown and cleanup.
	 * @param {ExtendedSocket} socket
	 * @param {(...args: any[]) => void} onData
	 * @param {(...args: any[]) => void} onEnd
	 */
	_onClose(socket, onData, onEnd)
	{
		if(socket._socket)
		{
			console.log(`Closing connection to ${socket._socket.remoteAddress}:${socket._socket.remotePort}`);
		}

		// Clean up direct bridged UDP socket if configured
		if(socket.bridge && socket.bridge.directUDPSocket)
		{
			console.log(`Tearing down active WebSocket <-> Native UDP bridge`);
			try
			{
				socket.bridge.directUDPSocket.close();
			} catch(err)
			{
				console.error('Failed closing bridged UDP socket:', err);
			}
		}

		socket.off('data', onData);
		socket.off('message', onData);
	}

	/**
	 * Handles parser errors.
	 * @param {ExtendedSocket} socket
	 * @param {(...args: any[]) => void} onData
	 * @param {(...args: any[]) => void} onEnd
	 * @param {Error} err
	 */
	_onParseError(socket, onData, onEnd, err)
	{
		console.error('Parse failure encountered:', err);
		socket.off('data', onData);
		socket.off('message', onData);
		if(typeof socket.close === 'function') socket.close();
	}

	/**
	 * Handles method authentication exchange.
	 * @param {Parser} parser
	 * @param {ExtendedSocket} socket
	 * @param {(...args: any[]) => void} onData
	 * @param {(...args: any[]) => void} onEnd
	 * @param {DataView} methods
	 */
	_onMethods(parser, socket, onData, onEnd, methods)
	{
		parser.authed = true;
		socket.off('data', onData);
		socket.off('message', onData);

		if(typeof socket.send === 'function')
		{
			socket.send(Buffer.from([0x05, 0x00]), { binary: true });
		}

		if(socket._socket && typeof socket._socket.resume === 'function')
		{
			socket._socket.resume();
		}

		socket.on('data', onData);
		socket.on('message', onData);
	}

	/**
	 * Route inbound command requests to externalized handlers.
	 * @param {ExtendedSocket} socket
	 * @param {(data: string | NonSharedBuffer) => void} onData
	 * @param {Function} onEnd
	 * @param {RequestInfo} reqInfo
	 */
	async _onRequest(socket, onData, onEnd, reqInfo)
	{
		const BUF_REP_GENFAIL = Buffer.from([0x05, 0x01]);

		if(socket._socket)
		{
			reqInfo.srcAddr = socket._socket.remoteAddress;
			reqInfo.srcPort = socket._socket.remotePort;
			if(typeof socket._socket.resume === 'function')
			{
				socket._socket.resume();
			}
		}

		// Handed off to modular proxyCommand
		//if(typeof proxyCommand === 'function')
		{
			try
			{
				reqInfo.dstIP ??= await this.lookupDNS(reqInfo.dstAddr || '0.0.0.0');
			} catch(e)
			{
				console.error('DNS error resolving WS target:', e);
				if(typeof socket.send === 'function')
				{
					socket.send(BUF_REP_GENFAIL, { binary: true });
				}
				if(typeof socket.close === 'function')
				{
					socket.close();
				}
				return;
			}

			await proxyCommand.call(this, socket, reqInfo, onData);
		} // else
		// {
		// 	console.warn('proxyCommand handler missing or unattached.');
		// }
	}

	/**
	 * @param {number} udpLookupPort
	 */
	_timeoutUDP(udpLookupPort)
	{
		if(this._listeners[udpLookupPort] !== undefined)
		{
			console.warn(`UDP socket timeout on port ${udpLookupPort}`);
			this._listeners[udpLookupPort].close?.();
			delete this._listeners[udpLookupPort];
			delete this._timeouts[udpLookupPort];
		}
	}
}

module.exports = {
	Server,
	HuffmanEngine,
	QuakeProtocol,
	SVC_STRINGS,
	CLC_STRINGS
};
