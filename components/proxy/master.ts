import * as dgram from 'dgram';
import * as http from 'http';
import { Socket } from 'net';
import { WebSocketServer, WebSocket } from 'ws';
import Parser from './socks.parser';

export type ExtendedSocket = WebSocket | Socket | & {
	parser: Parser;
	dstSock?: dgram.Socket;
	dstPort?: number;
	_socket: Socket;
	send: Function;
	close: Function;
	binding: boolean;
};


export interface GameServer
{
	addr: string;
	port: number;
	lastUpdate: number;
	info?: Record<string, string>;
}

export interface ClientConnection
{
	socket: {
		send: (data: ArrayBuffer | Uint8Array, options?: { binary?: boolean; }) => void;
		_socket?: {
			remoteAddress?: string;
			remotePort?: number;
		};
	};
	addr: string;
	port: number;
}

const connections: Record<string, ClientConnection> = {};
const clients: ClientConnection[] = [];
const servers: Record<string, GameServer> = {};
const PRUNE_INTERVAL = 350 * 1000;

/**
 * Formats Out-Of-Band (OOB) Quake 3 messages (\xff\xff\xff\xff + data + \x00)
 */
function formatOOB(data: string): ArrayBuffer
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
 * Strips OOB header (\xff\xff\xff\xff) from raw ArrayBuffer
 */
function stripOOB(buffer: ArrayBuffer): string | null
{
	const view = new DataView(buffer);

	if(buffer.byteLength < 5 || view.getInt32(0) !== -1)
	{
		return null;
	}

	let str = '';
	for(let i = 4; i < buffer.byteLength - 1; i++)
	{
		str += String.fromCharCode(view.getUint8(i));
	}

	return str;
}

/**
 * Parses Quake 3 info strings (\key\value\key\value)
 */
function parseInfoString(str: string): Record<string, string>
{
	const data: Record<string, string> = {};
	const split = str.split('\\');

	// Skip leading empty token if string starts with '\'
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

	return data; // Fixed missing return statement
}

const CHALLENGE_MIN_LENGTH = 9;
const CHALLENGE_MAX_LENGTH = 12;

function buildChallenge(): string
{
	let challenge = '';
	const length = CHALLENGE_MIN_LENGTH - 1 +
		Math.floor(Math.random() * (CHALLENGE_MAX_LENGTH - CHALLENGE_MIN_LENGTH + 1));

	for(let i = 0; i < length; i++)
	{
		let c: number;
		do
		{
			c = Math.floor(Math.random() * (126 - 33 + 1) + 33);
		} while(c === 92 || c === 59 || c === 34 || c === 37 || c === 47); // \, ;, ", %, /

		challenge += String.fromCharCode(c);
	}

	return challenge;
}

function handleGetServers(conn: ClientConnection): void
{
	console.log(`${conn.addr}:${conn.port} ---> getservers`);
	sendGetServersResponse(conn, servers);
}

function handleHeartbeat(conn: ClientConnection): void
{
	console.log(`${conn.addr}:${conn.port} ---> heartbeat`);
	sendGetInfo(conn);
}

function handleInfoResponse(conn: ClientConnection, data: string): void
{
	console.log(`${conn.addr}:${conn.port} ---> infoResponse`);
	const info = parseInfoString(data);
	updateServer(conn.addr, conn.port, info);
}

function sendGetInfo(conn: ClientConnection): void
{
	const challenge = buildChallenge();
	console.log(`${conn.addr}:${conn.port} <--- getinfo with challenge "${challenge}"`);

	const buffer = formatOOB(`getinfo ${challenge}`);
	conn.socket.send(buffer, { binary: true });
}

function sendGetServersResponse(conn: ClientConnection, serverList: Record<string, GameServer>): void
{
	let msg = 'getserversResponse';

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
	}
	msg += '\\EOT';

	console.log(`${conn.addr}:${conn.port} <--- getserversResponse with ${Object.keys(serverList).length} server(s)`);

	const buffer = formatOOB(msg);
	conn.socket.send(buffer, { binary: true });
}

function serverid(addr: string, port: number): string
{
	return `${addr}:${port}`;
}

function updateServer(addr: string, port: number, info?: Record<string, string>): void
{
	const id = serverid(addr, port);
	let server = servers[id];

	if(!server)
	{
		server = servers[id] = { addr, port, lastUpdate: Date.now() };
	}

	server.lastUpdate = Date.now();
	if(info) server.info = info;

	// Send server update to all subscribed clients
	const updatePayload: Record<string, GameServer> = {};
	updatePayload[id] = server;

	for(let i = 0; i < clients.length; i++)
	{
		sendGetServersResponse(clients[i], updatePayload);
	}
}

function removeServer(id: string): void
{
	const server = servers[id];
	if(!server) return;

	delete servers[id];
	console.log(`${server.addr}:${server.port} timed out, ${Object.keys(servers).length} server(s) currently registered`);
}

function pruneServers(): void
{
	const now = Date.now();

	for(const id in servers)
	{
		if(!Object.prototype.hasOwnProperty.call(servers, id)) continue;

		const server = servers[id];
		if(now - server.lastUpdate > PRUNE_INTERVAL)
		{
			removeServer(id);
		}
	}
}

function handleSubscribe(conn: ClientConnection): void
{
	addClient(conn);
	sendGetServersResponse(conn, servers);
}

function addClient(conn: ClientConnection): void
{
	if(clients.includes(conn)) return;

	console.log(`${conn.addr}:${conn.port} ---> subscribe`);
	clients.push(conn);
}

function removeClient(conn: ClientConnection): void
{
	const idx = clients.indexOf(conn);
	if(idx === -1) return;

	const key = `${conn.addr}:${conn.port}`;
	delete connections[key];

	console.log(`${conn.addr}:${conn.port} ---> unsubscribe`);
	clients.splice(idx, 1);
}

function getRemoteAddress(ws: any, req: http.IncomingMessage): string
{
	let address = ws._socket?.remoteAddress || req.socket.remoteAddress || '127.0.0.1';

	const forwarded = req.headers['x-forwarded-for'];
	if(typeof forwarded === 'string')
	{
		address = forwarded.split(',')[0].trim();
	}

	return address;
}

function getRemotePort(ws: any, req: http.IncomingMessage): number
{
	let port = ws._socket?.remotePort || req.socket.remotePort || 0;

	const forwardedPort = req.headers['x-forwarded-port'];
	if(typeof forwardedPort === 'string')
	{
		port = parseInt(forwardedPort, 10);
	}

	return port;
}

class Connection implements ClientConnection
{
	socket: any;
	addr: string;
	port: number;

	constructor(ws: any, req: http.IncomingMessage)
	{
		this.socket = ws;
		this.addr = getRemoteAddress(ws, req);
		this.port = getRemotePort(ws, req);
	}
}

function onMessage(conn: ClientConnection, buffer: Buffer): void
{
	const view = new Uint8Array(buffer);

	// Check for Emscripten UDP port handshake message
	if(
		view.byteLength === 10 &&
		view[0] === 255 && view[1] === 255 && view[2] === 255 && view[3] === 255 &&
		view[4] === 112 && view[5] === 111 && view[6] === 114 && view[7] === 116
	)
	{
		conn.port = (view[8] << 8) | view[9];
		return;
	}

	const msg = stripOOB(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
	console.log(msg);
	if(!msg)
	{
		removeClient(conn);
		return;
	}

	if(msg.startsWith('getservers '))
	{
		handleGetServers(conn);
	} else if(msg.startsWith('heartbeat '))
	{
		handleHeartbeat(conn);
	} else if(msg.startsWith('infoResponse\n') || msg.startsWith('infoResponse'))
	{
		handleInfoResponse(conn, msg.substring(13));
	} else if(msg.startsWith('subscribe'))
	{
		handleSubscribe(conn);
	} else
	{
		console.error(`Unexpected message: "${msg}"`);
	}
}

export async function startMasterServer(port: number): Promise<void>
{
	// Basic HTTP request listener to prevent hangs when accessed via browser
	const server = http.createServer((req, res) =>
	{
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({
			status: 'online',
			service: 'Quake 3 Master Server',
			registeredServers: Object.keys(servers).length,
			activeClients: clients.length
		}));
	});

	const wss = new WebSocketServer({ server });

	wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) =>
	{
		let conn = new Connection(ws, req);
		const key = `${conn.addr}:${conn.port}`;

		if(!connections[key])
		{
			connections[key] = conn;
		} else
		{
			conn = connections[key];
		}

		ws.on('message', (buffer: Buffer) =>
		{
			onMessage(conn, buffer);
		});

		ws.on('error', () => removeClient(conn));
		ws.on('close', () => removeClient(conn));
	});

	server.listen(port, '0.0.0.0', () =>
	{
		const addr = server.address() as any;
		console.log(`Tcp Master running at http://0.0.0.0:${addr.port}`);
	});

	const listener = dgram.createSocket('udp4');
	await new Promise<void>((resolve, reject) =>
	{
		listener
			.on('listening', () =>
			{
				console.log(`Udp Master running at udp://0.0.0.0:${port}`);
				resolve();
			})
			.on('error', reject)
			.on('message', (message: Buffer, rinfo: dgram.RemoteInfo) =>
			{
				const udpSocketWrapper = {
					send: (data: ArrayBuffer | Uint8Array) =>
					{
						const payload = Buffer.from(data as any);
						listener.send(payload, 0, payload.length, rinfo.port, rinfo.address);
					}
				};

				const dummyReq = {
					socket: { remoteAddress: rinfo.address, remotePort: rinfo.port },
					headers: {}
				} as unknown as http.IncomingMessage;

				let conn = new Connection(udpSocketWrapper, dummyReq);
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

// Auto-start if invoked directly via CLI
if(require.main === module)
{
	const argPort = parseInt(process.argv[2], 10);
	const port = isNaN(argPort) ? 27950 : argPort;
	startMasterServer(port).catch(console.error);
}

export default startMasterServer;
