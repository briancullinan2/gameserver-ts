/// <reference types="node" />
// @ts-check
const dgram = require('node:dgram');
const http = require('node:http');
const { WebSocketServer, WebSocket } = require('ws');

/**
 * @typedef {Object} GameServer
 * @property {string} addr
 * @property {number} port
 * @property {number} lastUpdate
 * @property {Record<string, string>} [info]
 */

/**
 * @typedef {Object} ClientConnection
 * @property {{ send: (data: ArrayBuffer | Uint8Array, options?: { binary?: boolean }) => void, _socket?: { remoteAddress?: string, remotePort?: number } }} socket
 * @property {string} addr
 * @property {number} port
 * @property {'udp' | 'ws'} [transport]
 */

/** @type {Record<string, ClientConnection>} */
const connections = {};

/** @type {ClientConnection[]} */
const clients = [];

/** @type {Record<string, GameServer>} */
const servers = {};

const PRUNE_INTERVAL = 350 * 1000;

/**
 * Formats Out-Of-Band (OOB) Quake 3 messages (\xff\xff\xff\xff + data + \x00)
 * @param {string} data
 * @returns {ArrayBuffer}
 */
function formatOOB(data)
{
	const str = '\xff\xff\xff\xff' + data + '\x00';
	const buffer = new ArrayBuffer(str.length);
	const view = new Uint8Array(buffer);

	for(let i = 0; i < str.length; i++)
	{
		view[i] = str.charCodeAt(i);
	}

	return buffer;
}

/**
 * Strips OOB header (\xff\xff\xff\xff) from raw ArrayBuffer / Uint8Array
 * @param {Uint8Array} view
 * @returns {string | null}
 */
function stripOOB(view)
{
	if(view.byteLength < 5)
	{
		return null;
	}

	// Check for \xff\xff\xff\xff (-1 in 32-bit signed int)
	if(view[0] !== 255 || view[1] !== 255 || view[2] !== 255 || view[3] !== 255)
	{
		return null;
	}

	let str = '';
	const end = view[view.byteLength - 1] === 0 ? view.byteLength - 1 : view.byteLength;
	for(let i = 4; i < end; i++)
	{
		str += String.fromCharCode(view[i]);
	}

	return str;
}

/**
 * Parses Quake 3 info strings (\key\value\key\value)
 * @param {string} str
 * @returns {Record<string, string>}
 */
function parseInfoString(str)
{
	/** @type {Record<string, string>} */
	const data = {};
	const split = str.split('\\');
	const startIdx = split[0] === '' ? 1 : 0;

	for(let i = startIdx; i < split.length - 1; i += 2)
	{
		const key = split[i];
		const value = split[i + 1];
		if(key)
		{
			data[key] = value;
		}
	}

	return data;
}

const CHALLENGE_MIN_LENGTH = 9;
const CHALLENGE_MAX_LENGTH = 12;

/**
 * @returns {string}
 */
function buildChallenge()
{
	let challenge = '';
	const length = CHALLENGE_MIN_LENGTH - 1 +
		Math.floor(Math.random() * (CHALLENGE_MAX_LENGTH - CHALLENGE_MIN_LENGTH + 1));

	for(let i = 0; i < length; i++)
	{
		let c;
		do
		{
			c = Math.floor(Math.random() * (126 - 33 + 1) + 33);
		} while(c === 92 || c === 59 || c === 34 || c === 37 || c === 47); // \, ;, ", %, /

		challenge += String.fromCharCode(c);
	}

	return challenge;
}

/**
 * Helper to turn raw buffer into safe readable ASCII or Hex string for debugging
 * @param {Uint8Array} view
 * @returns {string}
 */
function dumpRawBuffer(view)
{
	const printable = Array.from(view)
		.map(b => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
		.join('');
	const hex = Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('hex');
	return `[ASCII: "${printable}"] [HEX: ${hex}]`;
}

/**
 * @param {ClientConnection} conn
 * @param {string} [protocolStr]
 */
function handleGetServers(conn, protocolStr)
{
	console.log(`[SYS] [${conn.transport?.toUpperCase()}] ${conn.addr}:${conn.port} ---> getservers ${protocolStr || ''}`);
	sendGetServersResponse(conn, servers);
}

/**
 * @param {ClientConnection} conn
 */
function handleHeartbeat(conn)
{
	console.log(`[SYS] [${conn.transport?.toUpperCase()}] ${conn.addr}:${conn.port} ---> heartbeat received`);
	sendGetInfo(conn);
}

/**
 * @param {ClientConnection} conn
 * @param {string} data
 */
function handleInfoResponse(conn, data)
{
	console.log(`[SYS] [${conn.transport?.toUpperCase()}] ${conn.addr}:${conn.port} ---> infoResponse received`);
	const info = parseInfoString(data);
	console.log(`[SYS] Parsed server info from ${conn.addr}:${conn.port}:`, info);
	updateServer(conn.addr, conn.port, info);
}

/**
 * @param {ClientConnection} conn
 */
function sendGetInfo(conn)
{
	const challenge = buildChallenge();
	console.log(`[SYS] [${conn.transport?.toUpperCase()}] ${conn.addr}:${conn.port} <--- sending getinfo (challenge: "${challenge}")`);

	const buffer = formatOOB(`getinfo ${challenge}`);
	conn.socket.send(buffer, { binary: true });
}

/**
 * @param {ClientConnection} conn
 * @param {Record<string, GameServer>} serverList
 */
function sendGetServersResponse(conn, serverList)
{
	let msg = 'getserversResponse';
	let count = 0;

	for(const id in serverList)
	{
		if(!Object.prototype.hasOwnProperty.call(serverList, id)) continue;

		const server = serverList[id];
		if(!server || !server.addr) continue;

		const octets = server.addr.split('.').map(n => parseInt(n, 10));
		if(octets.length !== 4) continue;

		msg += '\\';
		msg += String.fromCharCode(octets[0] & 0xff);
		msg += String.fromCharCode(octets[1] & 0xff);
		msg += String.fromCharCode(octets[2] & 0xff);
		msg += String.fromCharCode(octets[3] & 0xff);
		msg += String.fromCharCode((server.port & 0xff00) >> 8);
		msg += String.fromCharCode(server.port & 0xff);
		count++;
	}
	msg += '\\EOT';

	console.log(`[SYS] [${conn.transport?.toUpperCase()}] ${conn.addr}:${conn.port} <--- getserversResponse sent (${count} server(s))`);

	const buffer = formatOOB(msg);
	conn.socket.send(buffer, { binary: true });
}

/**
 * @param {string} addr
 * @param {number} port
 * @returns {string}
 */
function serverid(addr, port)
{
	return `${addr}:${port}`;
}

/**
 * @param {string} addr
 * @param {number} port
 * @param {Record<string, string>} [info]
 */
function updateServer(addr, port, info)
{
	const id = serverid(addr, port);
	let server = servers[id];

	if(!server)
	{
		server = servers[id] = { addr, port, lastUpdate: Date.now() };
		console.log(`[SYS] Registering new server: ${id}`);
	} else
	{
		console.log(`[SYS] Updating existing server: ${id}`);
	}

	server.lastUpdate = Date.now();
	if(info) server.info = info;

	/** @type {Record<string, GameServer>} */
	const updatePayload = {};
	updatePayload[id] = server;

	console.log(`[SYS] Broadcasting updated server list to ${clients.length} subscribed client(s)`);
	for(let i = 0; i < clients.length; i++)
	{
		sendGetServersResponse(clients[i], updatePayload);
	}
}

/**
 * @param {string} id
 */
function removeServer(id)
{
	const server = servers[id];
	if(!server) return;

	delete servers[id];
	console.log(`[SYS] ${server.addr}:${server.port} timed out and removed (${Object.keys(servers).length} server(s) remaining)`);
}

function pruneServers()
{
	const now = Date.now();
	let checked = 0;

	for(const id in servers)
	{
		if(!Object.prototype.hasOwnProperty.call(servers, id)) continue;
		checked++;

		const server = servers[id];
		if(now - server.lastUpdate > PRUNE_INTERVAL)
		{
			removeServer(id);
		}
	}
	if(checked > 0)
	{
		console.log(`[PRUNE] Checked ${checked} server(s); ${Object.keys(servers).length} active.`);
	}
}

/**
 * @param {ClientConnection} conn
 */
function handleSubscribe(conn)
{
	addClient(conn);
	sendGetServersResponse(conn, servers);
}

/**
 * @param {ClientConnection} conn
 */
function addClient(conn)
{
	if(clients.includes(conn)) return;

	console.log(`[SYS] [${conn.transport?.toUpperCase()}] ${conn.addr}:${conn.port} ---> subscribed`);
	clients.push(conn);
}

/**
 * @param {ClientConnection} conn
 */
function removeClient(conn)
{
	const idx = clients.indexOf(conn);
	if(idx === -1) return;

	const key = `${conn.addr}:${conn.port}`;
	delete connections[key];

	console.log(`[SYS] [${conn.transport?.toUpperCase()}] ${conn.addr}:${conn.port} ---> unsubscribed`);
	clients.splice(idx, 1);
}

/**
 * @param {any} ws
 * @param {http.IncomingMessage} req
 * @returns {string}
 */
function getRemoteAddress(ws, req)
{
	let address = ws._socket?.remoteAddress || req.socket.remoteAddress || '127.0.0.1';

	const forwarded = req.headers['x-forwarded-for'];
	if(typeof forwarded === 'string')
	{
		address = forwarded.split(',')[0].trim();
	}

	return address;
}

/**
 * @param {any} ws
 * @param {http.IncomingMessage} req
 * @returns {number}
 */
function getRemotePort(ws, req)
{
	let port = ws._socket?.remotePort || req.socket.remotePort || 0;

	const forwardedPort = req.headers['x-forwarded-port'];
	if(typeof forwardedPort === 'string')
	{
		port = parseInt(forwardedPort, 10);
	}

	return typeof port === 'string' ? parseInt(port, 10) : port;
}

class Connection
{
	/**
	 * @param {any} ws
	 * @param {http.IncomingMessage} req
	 * @param {'udp' | 'ws'} [transport='ws']
	 */
	constructor(ws, req, transport = 'ws')
	{
		this.socket = ws;
		this.addr = getRemoteAddress(ws, req);
		this.port = getRemotePort(ws, req);
		this.transport = transport;
	}
}

/**
 * @param {ClientConnection} conn
 * @param {Buffer} buffer
 */
function onMessage(conn, buffer)
{
	const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

	// Check for Emscripten UDP port handshake message
	if(
		view.byteLength === 10 &&
		view[0] === 255 && view[1] === 255 && view[2] === 255 && view[3] === 255 &&
		view[4] === 112 && view[5] === 111 && view[6] === 114 && view[7] === 117
	)
	{
		const oldPort = conn.port;
		conn.port = (view[8] << 8) | view[9];
		console.log(`[SYS] [${conn.transport?.toUpperCase()}] ${conn.addr}:${oldPort} updated UDP target port to ${conn.port}`);
		return;
	}

	const msg = stripOOB(view);

	if(!msg)
	{
		console.warn(`[WARN] [${conn.transport?.toUpperCase()}] Non-OOB or invalid payload from ${conn.addr}:${conn.port} (${view.byteLength} bytes): ${dumpRawBuffer(view)}`);
		return;
	}

	console.log(`[RECV] [${conn.transport?.toUpperCase()}] ${conn.addr}:${conn.port} -> "${msg.trim()}"`);

	if(msg.startsWith('getservers'))
	{
		const parts = msg.split(' ');
		handleGetServers(conn, parts[1]);
	} else if(msg.startsWith('heartbeat'))
	{
		handleHeartbeat(conn);
	} else if(msg.startsWith('infoResponse'))
	{
		handleInfoResponse(conn, msg.substring(12));
	} else if(msg.startsWith('subscribe'))
	{
		handleSubscribe(conn);
	} else
	{
		console.error(`[ERR] [${conn.transport?.toUpperCase()}] Unhandled command from ${conn.addr}:${conn.port}: "${msg.trim()}"`);
	}
}

/**
 * @param {number} port
 * @returns {Promise<void>}
 */
async function startMasterServer(port)
{
	const server = http.createServer((req, res) =>
	{
		console.log(`[HTTP] ${req.method} request to ${req.url} from ${req.socket.remoteAddress}`);
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({
			status: 'online',
			service: 'Quake 3 Master Server',
			registeredServers: Object.keys(servers).length,
			activeClients: clients.length,
			serverList: Object.keys(servers)
		}));
	});

	const wss = new WebSocketServer({ server });

	wss.on('connection', (ws, req) =>
	{
		let conn = /** @type {ClientConnection} */ (new Connection(ws, req, 'ws'));
		const key = `${conn.addr}:${conn.port}`;
		console.log(`[NET] WebSocket connected from ${key}`);

		if(!connections[key])
		{
			connections[key] = conn;
		} else
		{
			conn = connections[key];
		}

		ws.on('message', (buffer) =>
		{
			onMessage(conn, /** @type {Buffer} */(buffer));
		});

		ws.on('error', (err) =>
		{
			console.error(`[ERR] WebSocket error from ${key}:`, err);
			removeClient(conn);
		});

		ws.on('close', (code, reason) =>
		{
			console.log(`[NET] WebSocket disconnected from ${key} (Code: ${code}, Reason: ${reason.toString() || 'None'})`);
			removeClient(conn);
		});
	});

	await new Promise(res =>
	{
		server.listen(port, '0.0.0.0', () =>
		{
			const addr = /** @type {import('net').AddressInfo} */ (server.address());
			console.log(`[INIT] TCP/WebSocket Master Server listening at http://0.0.0.0:${addr.port}`);
			res(undefined);
		});
	});

	const listener = dgram.createSocket('udp4');
	await new Promise((resolve, reject) =>
	{
		listener
			.on('listening', () =>
			{
				console.log(`[INIT] UDP Master Server listening at udp://0.0.0.0:${port}`);
				resolve(null);
			})
			.on('error', (err) =>
			{
				console.error(`[ERR] UDP socket error:`, err);
				reject(err);
			})
			.on('message', (message, rinfo) =>
			{
				console.log(message, rinfo);
				const udpSocketWrapper = {
					send: (/** @type {ArrayBuffer | Uint8Array} */ data) =>
					{
						const payload = Buffer.from(/** @type {any} */(data));
						listener.send(payload, 0, payload.length, rinfo.port, rinfo.address, (err) =>
						{
							if(err) console.error(`[ERR] Failed sending UDP packet to ${rinfo.address}:${rinfo.port}`, err);
						});
					}
				};

				const dummyReq = /** @type {http.IncomingMessage} */ (/** @type {unknown} */ ({
					socket: { remoteAddress: rinfo.address, remotePort: rinfo.port },
					headers: {}
				}));

				let conn = /** @type {ClientConnection} */ (new Connection(udpSocketWrapper, dummyReq, 'udp'));
				const key = `${conn.addr}:${conn.port}`;

				if(!connections[key])
				{
					connections[key] = conn;
				} else
				{
					conn = connections[key];
				}

				onMessage(conn, message);
			})
			.bind(port, '0.0.0.0');
	});

	setInterval(pruneServers, PRUNE_INTERVAL);
}

(async function main()
{
	var port = parseInt(process.argv[2]);
	if(isNaN(port)) port = 27950;
	if(process.argv[1].match(/[\/\\]master\.js$/ig) || process.argv[1].match(/[\/\\]index\.js$/ig))
	{
		await startMasterServer(port);
	}
})();

module.exports = startMasterServer;
