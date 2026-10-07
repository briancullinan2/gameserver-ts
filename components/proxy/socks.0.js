/// <reference types="node" />

// @ts-check

/**
 * @file proxy_utils.js
 * @description Internal SOCKS5 Utility Helpers for UDP framing, connection replies, and error handling.
 */

const ip6addr = require('ip6addr');

// ============================================================================
// TYPE DECLARATIONS & IMPORTS
// ============================================================================

/**
 * @typedef {import('./socks.server.js').Server} Server
 * @typedef {import('./socks.server.js').ExtendedSocket} ExtendedSocket
 * @typedef {import('./socks.server.js').RequestInfo} RequestInfo
 */

/**
 * SOCKS5 Protocol Constants
 */
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

// Import SHOWNET if present
let SHOWNET = (/** @type {any[]} */ ...args) => { };
try
{
	SHOWNET = require('./shownet');
} catch(e)
{
	// Optional network debugger
}

// ============================================================================
// SERVER UTILITY METHODS
// ============================================================================

/**
 * @this {Server}
 * @param {ExtendedSocket} socket
 * @param {import('./socks.server.js').RequestInfo} reqInfo
 * @param {(data: string | NonSharedBuffer) => void} onData
 */
async function proxyCommand(socket, reqInfo, onData)
{
	console.log(reqInfo);
	switch(reqInfo.cmd)
	{
		case 0x01: // CONNECT
			const { proxyCONNECTCommand } = require('./socks.1.js');
			await proxyCONNECTCommand.call(this, socket, reqInfo, onData);
			break;
		case 0x02: // BIND
			const { proxyBINDCommand } = require('./socks.2.js');
			await proxyBINDCommand.call(this, socket, reqInfo, onData);
			break;
		case 0x03: // UDP ASSOCIATE
			const { proxyUDPCommand } = require('./socks.3.js');
			await proxyUDPCommand.call(this, socket, reqInfo, onData);
			break;
		case 0x04: // WEBSOCKET BRIDGE
			const { proxyWSCommand } = require('./socks.4.js');
			await proxyWSCommand.call(this, socket, reqInfo, onData);
			break;
		default:
			console.warn(`Unknown or unsupported command code: ${reqInfo.cmd}`);
			break;
	}
}


// ============================================================================
// GLOBAL LOGGER & TOGGLEABLE CONSOLE OVERRIDE
// ============================================================================

class Logger
{
	/** @type {boolean} */
	static enabled = true;

	/**
	 * Global toggle for proxy server logging.
	 * @param {boolean} flag
	 */
	static setLogging(flag)
	{
		Logger.enabled = Boolean(flag);
	}

	static enable()
	{
		Logger.enabled = true;
	}

	static disable()
	{
		Logger.enabled = false;
	}

	/**
	 * Output informational log messages.
	 * @param {...any} args
	 */
	static log(...args)
	{
		if(Logger.enabled)
		{
			console.log(`[PROXY INFO ${new Date().toISOString()}]`, ...args);
		}
	}

	/**
	 * Output warning log messages.
	 * @param {...any} args
	 */
	static warn(...args)
	{
		if(Logger.enabled)
		{
			console.warn(`[PROXY WARN ${new Date().toISOString()}]`, ...args);
		}
	}

	/**
	 * Output error log messages.
	 * @param {...any} args
	 */
	static error(...args)
	{
		if(Logger.enabled)
		{
			console.error(`[PROXY ERR  ${new Date().toISOString()}]`, ...args);
		}
	}
}

/**
 * Constructs and dispatches SOCKS5 UDP encapsulation frames or WebSocket bridge payloads.
 * Expects execution context (`this`) to be bound to the `Server` instance.
 *
 * @this {Server}
 * @param {number} udpLookupPort Local listening port mapped to the active socket.
 * @param {boolean} isWebSocket True if forwarding over WebSocket connection.
 * @param {boolean | Buffer | ArrayBuffer} message Raw UDP payload or handshake flag.
 * @param {import('dgram').RemoteInfo} rinfo Originating network address details.
 * @returns {void}
 */
function _onUDPMessage(udpLookupPort, isWebSocket, message, rinfo)
{
	const socket = this._receivers[udpLookupPort];
	if(!socket) return;

	const returnIP = false;
	const rawAddr = rinfo.address || '127.0.0.1';
	const ipv6 = ip6addr.parse(rawAddr);
	let localbytes = ipv6.toBuffer();

	// Strip IPv4-mapped IPv6 prefix (::ffff:)
	if(ipv6.kind() === 'ipv4')
	{
		localbytes = localbytes.slice(12);
	}

	// Check DNS cache for reverse domain mapping
	let domain = Object.keys(this._dnsLookup).find(
		(n) => this._dnsLookup[n] === rawAddr
	);

	if(domain && isWebSocket)
	{
		domain = `ws://${domain}`;
	}

	const isRawIP = returnIP || !domain;
	const bufLength = isRawIP || !domain
		? 4 + localbytes.length + 2
		: 4 + 1 + domain.length + 2;

	const bufrep = Buffer.alloc(bufLength);

	// Build SOCKS5 Header: [RSV, RSV, FRAG, ATYP]
	bufrep[0] = 0x00; // Reserved
	bufrep[1] = 0x00; // Reserved
	bufrep[2] = 0x00; // Frag sequence (0 = standalone)

	if(isRawIP || !domain)
	{
		bufrep[3] = ipv6.kind() === 'ipv4' ? ATYP.IPv4 : ATYP.IPv6;
		for(let i = 0, p = 4; i < localbytes.length; ++i, ++p)
		{
			bufrep[p] = localbytes[i];
		}
		const portOffset = 4 + localbytes.length;
		// Port MUST be Network Byte Order (Big Endian)
		bufrep.writeUInt16LE(rinfo.port, portOffset);
	} else
	{
		bufrep[3] = ATYP.NAME;
		bufrep[4] = domain.length;
		bufrep.write(domain, 5);

		const portOffset = 5 + domain.length;
		bufrep.writeUInt16LE(rinfo.port, portOffset);
	}

	if(typeof SHOWNET === 'function')
	{
		SHOWNET(message, socket, false);
	}

	// Construct final output payload
	const isHandshakeOnly = message === true;
	const payload = isHandshakeOnly
		? bufrep
		: Buffer.concat([bufrep, Buffer.isBuffer(message) ? message : Buffer.from(/** @type {ArrayBuffer} */(message))]);

	if(typeof socket.send === 'function')
	{
		socket.send(payload, { binary: true });
	}

	this._timeouts[udpLookupPort] = Date.now();
}

/**
 * Responds to SOCKS5 client upon successful TCP/UDP socket binding.
 * Expects execution context (`this`) to be bound to the `Server` instance.
 *
 * @this {Server}
 * @param {number} udpLookupPort Local listening port mapped to receiver.
 * @param {RequestInfo} reqInfo Decoded SOCKS request parameters.
 * @returns {void}
 */
function _onSocketConnect(udpLookupPort, reqInfo)
{
	const socket = this._receivers[udpLookupPort];
	if(!socket)
	{
		console.warn('Port: ' + udpLookupPort + ' not found. Leaving.');
		return;
	}

	const netSocket = socket._socket;
	if(netSocket && netSocket.writable === false)
	{
		console.warn('Socket: ' + udpLookupPort + ' not writable. Leaving.');
		return;
	}

	// Standardize local loopback string
	const rawLocalAddr = netSocket?.localAddress === '::1' ? '127.0.0.1' : netSocket?.localAddress || '127.0.0.1';
	const ipv6 = ip6addr.parse(rawLocalAddr);
	let localbytes = ipv6.toBuffer();

	if(ipv6.kind() === 'ipv4')
	{
		localbytes = localbytes.slice(12);
	}

	const bufrep = Buffer.alloc(6 + localbytes.length);
	bufrep[0] = 0x05; // SOCKS5 Version
	bufrep[1] = REP.SUCCESS;
	bufrep[2] = 0x00; // Reserved
	bufrep[3] = ipv6.kind() === 'ipv4' ? ATYP.IPv4 : ATYP.IPv6;

	let p = 4;
	for(let i = 0; i < localbytes.length; ++i, ++p)
	{
		bufrep[p] = localbytes[i];
	}

	const boundPort = netSocket?.localPort || reqInfo.dstPort || 0;
	// Port MUST be Big Endian for network byte order compliance
	bufrep.writeUInt16LE(boundPort, p);

	if(typeof socket.send === 'function')
	{
		socket.send(bufrep, { binary: true });
	}

	// Full-duplex piping if target is a stream socket
	if(socket.dstSock && typeof (/** @type {any} */ (socket.dstSock).pipe) === 'function' && netSocket)
	{
		console.log(`Piping stream between local socket and destination target on port ${boundPort}`);
		netSocket.pipe(/** @type {any} */(socket.dstSock));
    /** @type {any} */ (socket.dstSock).pipe(netSocket);
	} else
	{
		console.log(`Initialized SOCKS message route on ${ipv6.kind()} port ${boundPort}`);
	}
}

/**
 * Handles proxy execution errors and sends standard SOCKS5 error replies.
 * Expects execution context (`this`) to be bound to the `Server` instance.
 *
 * @this {Server}
 * @param {number} udpLookupPort Target receiver port.
 * @param {Error & { code?: string }} err
 * @returns {void}
 */
function _onProxyError(udpLookupPort, err)
{
	console.error(`Proxy Error on lookup port ${udpLookupPort}:`, err);

	const socket = this._receivers[udpLookupPort];
	if(!socket) return;

	const netSocket = socket._socket;
	if(netSocket && netSocket.writable === false) return;

	const errbuf = Buffer.from([0x05, REP.GENFAIL, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

	if(err && err.code)
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
			default:
				errbuf[1] = REP.GENFAIL;
				break;
		}
	}

	if(typeof socket.send === 'function')
	{
		socket.send(errbuf, { binary: true });
	}
}

// Module Exports
module.exports = {
	Logger,
	_onUDPMessage,
	_onSocketConnect,
	_onProxyError,
	ATYP,
	REP,
	proxyCommand,
};
