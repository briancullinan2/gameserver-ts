/// <reference types="node" />

const { EventEmitter } = require("node:stream");

// @ts-check

/**
* Toggle verbose console output globally without changing method calls.
*/
let debugLoggingEnabled = true;

const nativeLog = console.log;
const nativeWarn = console.warn;
const nativeError = console.error;
const nativeInfo = console.info;

console.log = (...args) => { if(debugLoggingEnabled) nativeLog.apply(console, args); };
console.warn = (...args) => { if(debugLoggingEnabled) nativeWarn.apply(console, args); };
console.error = (...args) => { if(debugLoggingEnabled) nativeError.apply(console, args); };
console.info = (...args) => { if(debugLoggingEnabled) nativeInfo.apply(console, args); };

/**
* Configure global console logging output.
* @param {boolean} enabled
*/
function setDebugLogging(enabled)
{
	debugLoggingEnabled = Boolean(enabled);
}

/**
* SOCKS5 Standard & Extended Commands
* SOCKS5 defines 0x01 (CONNECT), 0x02 (BIND), 0x03 (UDP ASSOCIATE).
* Standard extensions allow binding custom protocols over SOCKS stream wrappers.
*/
const CMD = {
	CONNECT: 0x01,
	BIND: 0x02,
	UDP: 0x03,
	WS: 0x04,
	HTTP: 0x05,
	DNS: 0x06,
	PING: 0x07,
	SUBNET_DISCOVERY: 0x08
};

const ATYP = {
	IPv4: 0x01,
	NAME: 0x03,
	IPv6: 0x04
};

const STATE_VERSION = 0;
const STATE_NMETHODS = 1;
const STATE_METHODS = 2;
const STATE_REQ_CMD = 3;
const STATE_REQ_RSV = 4;
const STATE_REQ_ATYP = 5;
const STATE_REQ_DSTADDR = 6;
const STATE_REQ_DSTADDR_VARLEN = 7;
const STATE_REQ_DSTPORT = 8;

/**
* Formats a Buffer or Uint8Array into hex sequence rows:
* 0xXX 0xXX 0xXX 0xXX  0xXX 0xXX 0xXX 0xXX (8 bytes per row)
* @param {Buffer | Uint8Array} buf
* @returns {string}
*/
function formatHexSequenceOld(buf)
{
	if(!buf || buf.length === 0) return '(empty buffer)';
	const rows = [];
	for(let i = 0; i < buf.length; i += 8)
	{
		const chunk = buf.subarray(i, i + 8);
		const hexBytes = Array.from(chunk).map(b => '0x' + b.toString(16).padStart(2, '0'));
		if(hexBytes.length > 4)
		{
			const left = hexBytes.slice(0, 4).join(' ');
			const right = hexBytes.slice(4).join(' ');
			rows.push(`${left}  ${right}`);
		} else
		{
			rows.push(hexBytes.join(' '));
		}
	}
	return rows.join('\n');
}

/**
 *
 * @param {Buffer | Uint8Array} buf
 * @returns {string}
 */
function formatHexSequence(buf)
{
	if(!buf || buf.length === 0) return '(empty buffer)';

	const rows = [];

	for(let i = 0; i < buf.length; i += 8)
	{
		const chunk = buf.subarray(i, i + 8);
		const hexBytes = Array.from(chunk).map(b => '0x' + b.toString(16).padStart(2, '0'));

		// Convert printable ASCII chars (32 to 126), replace non-printable/control chars with '.'
		const asciiChars = Array.from(chunk)
			.map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.')
			.join('');

		// Format Hex Bytes (4 x 2)
		let hexStr = '';
		if(hexBytes.length > 4)
		{
			const left = hexBytes.slice(0, 4).join(' ');
			const right = hexBytes.slice(4).join(' ');
			hexStr = `${left}  ${right}`;
		} else
		{
			hexStr = hexBytes.join(' ');
		}

		// Pad last line if chunk has fewer than 8 bytes to keep ASCII column aligned
		// (Each byte takes 4 chars + 1 space = 5 chars per byte; extra space between the two 4-byte halves)
		if(chunk.length < 8)
		{
			const missingBytes = 8 - chunk.length;
			const extraHalfSpace = chunk.length < 4 ? 2 : 0;
			const paddingLength = (missingBytes * 5) + extraHalfSpace;
			hexStr = hexStr.padEnd(41, ' '); // 41 is full width of 8 bytes formatted
		}

		rows.push(`${hexStr}  | ${asciiChars} |`);
	}

	return rows.join('\n');
}

/**
* ES6 SOCKS5 & Multiplex Protocol Stream Parser
*/
class Parser extends EventEmitter
{
	static CMD = CMD;
	static ATYP = ATYP;

	/**
	* @param {any} ws WebSocket or Underlying Socket Connection
	*/
	constructor(ws)
	{
		super();
		this._ws = ws;
		this._listening = false;


		this._buffer = Buffer.alloc(1400 * 3, 0);
		this._state = STATE_VERSION;
		/** @type {Buffer | undefined} */
		this._methods = undefined;
		this._methodsp = 0;

		this.authed = false;


	}

	/**
	* Process incoming network frame chunks.
	* @param {Buffer | string | null} message
	*/
	_onData(message)
	{
		let _dstaddr = undefined;
		let _dstaddrp = 0;
		let _dstport = undefined;
		let _atyp = 0;
		let _cmd = 0;


		if(message === null)
		{
			this._buffer.fill(0);
			return;
		}

		const inputLength = typeof message === 'string' ? Buffer.byteLength(message) : message.length;
		if(typeof message === 'string')
		{
			this._buffer.write(message);
		} else
		{
			message.copy(this._buffer, 0, 0, message.length);
		}

		let state = this._state;
		let i = 0;
		const len = inputLength;
		let left = 0;
		let chunkLeft = 0;
		let minLen = 0;

		if(this.authed && Object.values(ATYP).includes(this._buffer[3]))
		{
			this._buffer[0] = 0x05;
			this._buffer[1] = this._buffer[1] || 0x01;
			this._buffer[2] = 0x00;
		}

		while(i < len)
		{
			// Custom Emscripten Q3 UDP port handshake detection
			if(
				this._buffer[i] === 0xFF && this._buffer[i + 1] === 0xFF &&
				this._buffer[i + 2] === 0xFF && this._buffer[i + 3] === 0xFF &&
				this._buffer[i + 4] === 112 && // 'p'
				this._buffer[i + 5] === 111 && // 'o'
				this._buffer[i + 6] === 114 && // 'r'
				this._buffer[i + 7] === 116    // 't'
			)
			{
				// TODO: prevent socket hijacking by reassining to somebody elses socket
				_dstport = (this._buffer[i + 8] << 8) + this._buffer[i + 9];
				this.authed = true;
				console.info(`[SOCKS Parser] Intercepted UDP port handshake -> Port ${_dstport}`);
				this.emit('request', {
					cmd: CMD.UDP,
					dstPort: _dstport
				});
				return;
			}

			switch(state)
			{
				/*
					+----+----------+----------+----------+
					|VER | NMETHODS | METHODS  | CMD      |
					+----+----------+----------+----------+
					| 1  |    1     | 1 to 255 | 1 - 8    |
					+----+----------+----------+----------+
				*/
				case STATE_VERSION:
					if(this._buffer[i] !== 0x05)
					{
						if(this.authed && this._buffer[i] === 0x00)
						{
							// Valid padding byte under authenticated session
						} else
						{
							if(this._buffer[i] !== 0x00)
							{
								const rawSlice = this._buffer.subarray(0, Math.min(len, 16));
								const hexDump = formatHexSequence(rawSlice);
								console.error(`[SOCKS Parser Error] Incompatible SOCKS version byte (0x${this._buffer[i].toString(16)}):\n${hexDump}`);
								this.emit('error', new Error(`Incompatible SOCKS protocol version: ${this._buffer[i]}\nHex sequence:\n${hexDump}`));
							}
							return;
						}
					}
					++i;
					if(this.authed)
					{
						state = STATE_REQ_CMD;
					} else
					{
						++state;
					}
					break;

				case STATE_NMETHODS:
					const nmethods = this._buffer[i];
					if(nmethods === 0)
					{
						const rawSlice = this._buffer.subarray(0, Math.min(len, 16));
						const hexDump = formatHexSequence(rawSlice);
						console.error(`[SOCKS Parser Error] Empty client method list encountered:\n${hexDump}`);
						this.emit('error', new Error(`Unexpected empty methods list\nHex sequence:\n${hexDump}`));
						return;
					}
					++i;
					++state;
					this._methods = Buffer.alloc(nmethods);
					this._methodsp = 0;
					break;

				case STATE_METHODS:
					if(!this._methods)
					{
						break;
					}
					left = this._methods.length - this._methodsp;
					chunkLeft = len - i;
					minLen = left < chunkLeft ? left : chunkLeft;
					this._buffer.copy(this._methods, this._methodsp, i, i + minLen);
					this._methodsp += minLen;
					i += minLen;

					if(this._methodsp === this._methods.length)
					{
						this._state = STATE_VERSION;
						const methods = this._methods;
						this._methods = undefined;

						if(this._ws && this._ws._socket && typeof this._ws._socket.pause === 'function')
						{
							this._ws._socket.pause();
						}
						console.info(`[SOCKS Parser] Auth methods frame parsed: ${methods.length} method(s) supported.`);
						this.emit('methods', methods);
						return;
					}
					break;

				case STATE_REQ_CMD:
					const cmd = this._buffer[i];
					_cmd = cmd || CMD.CONNECT;

					// Support extended protocol ranges (CONNECT, BIND, UDP, WS, HTTP, DNS, PING, SUBNET)
					if(cmd < (CMD.CONNECT ?? 0x01) || cmd > (CMD.SUBNET_DISCOVERY ?? 0x08))
					{
						const rawSlice = this._buffer.subarray(Math.max(0, i - 2), Math.min(len, i + 8));
						const hexDump = formatHexSequence(rawSlice);
						console.error(`[SOCKS Parser Error] Invalid or unsupported command (0x${cmd.toString(16)}):\n${hexDump}`);
						this.emit('error', new Error(`Invalid request command: ${cmd}\nHex sequence:\n${hexDump}`));
						return;
					}
					_dstport = undefined;
					++i;
					++state;
					break;

				case STATE_REQ_RSV:
					++i;
					++state;
					break;

				case STATE_REQ_ATYP:
					const atyp = this._buffer[i];
					state = STATE_REQ_DSTADDR;

					if(atyp === ATYP.IPv4)
					{
						_dstaddr = Buffer.alloc(4);
					} else if(atyp === ATYP.IPv6)
					{
						_dstaddr = Buffer.alloc(16);
					} else if(atyp === ATYP.NAME)
					{
						state = STATE_REQ_DSTADDR_VARLEN;
					} else if(atyp === 0)
					{
						console.info('[SOCKS Parser] Received Keep-Alive Ping frame (ATYP 0x00).');
						this.emit('ping');
						return;
					} else
					{
						const rawSlice = this._buffer.subarray(Math.max(0, i - 3), Math.min(len, i + 8));
						const hexDump = formatHexSequence(rawSlice);
						console.error(`[SOCKS Parser Error] Invalid address type ATYP (0x${atyp.toString(16)}):\n${hexDump}`);
						this.emit('error', new Error(`Invalid request address type: ${atyp}\nHex sequence:\n${hexDump}`));
						return;
					}
					_atyp = atyp;
					++i;
					break;

				case STATE_REQ_DSTADDR:
					if(!_dstaddr)
					{
						break;
					}
					left = _dstaddr.length - _dstaddrp;
					chunkLeft = len - i;
					minLen = left < chunkLeft ? left : chunkLeft;
					this._buffer.copy(_dstaddr, _dstaddrp, i, i + minLen);
					_dstaddrp += minLen;
					i += minLen;

					if(_dstaddrp === _dstaddr.length)
					{
						state = STATE_REQ_DSTPORT;
					}
					break;

				case STATE_REQ_DSTADDR_VARLEN:
					_dstaddr = Buffer.alloc(this._buffer[i]);
					_dstaddrp = 0;
					state = STATE_REQ_DSTADDR;
					++i;
					break;

				case STATE_REQ_DSTPORT:
					if(!_dstaddr)
					{
						break;
					}
					if(_dstport === undefined)
					{
						_dstport = this._buffer[i];
					} else
					{
						_dstport <<= 8;
						_dstport += this._buffer[i];
						++i;

						let formattedAddress = '';
						if(_atyp === ATYP.IPv4)
						{
							formattedAddress = Array.prototype.join.call(_dstaddr, '.');
						} else if(_atyp === ATYP.IPv6)
						{
							let ipv6str = '';
							for(let b = 0; b < 16; ++b)
							{
								if(b % 2 === 0 && b > 0) ipv6str += ':';
								ipv6str += _dstaddr[b].toString(16).padStart(2, '0');
							}
							formattedAddress = ipv6str;
						} else
						{
							formattedAddress = _dstaddr.toString('utf8');
						}

						if(this._ws && this._ws._socket && typeof this._ws._socket.pause === 'function')
						{
							this._ws._socket.pause();
						}

						const cleanAddress = formattedAddress.replace(/\0/g, '');
						console.info(`[SOCKS Parser] Request: CMD 0x${_cmd.toString(16)} -> ${cleanAddress}:${_dstport}`);

						this.emit('request', {
							cmd: _cmd,
							srcAddr: undefined,
							srcPort: undefined,
							dstAddr: cleanAddress,
							dstPort: _dstport,
							data: Buffer.from(this._buffer.subarray(i, len))
						});
						return;
					}
					++i;
					break;
			}
		}

		this._state = state;


	}
}

module.exports = Parser;
