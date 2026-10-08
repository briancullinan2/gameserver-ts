import { Worker, isMainThread, workerData, parentPort } from 'worker_threads';
import * as net from 'net';
import * as dgram from 'dgram';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

// =============================================================================
// TYPE DEFINITIONS & CONTRACTS
// =============================================================================

export type WorkerRole = 'HTTP_WS_WORKER' | 'UDP_TCP_WORKER';

export interface WorkerDataPayload
{
	role: WorkerRole;
	id: number;
}

// --- HTTP / WS Message Types ---
export interface HttpRequestMessage
{
	type: 'HTTP_REQUEST';
	requestId: string;
	method: string | undefined;
	url: string | undefined;
	headers: http.IncomingHttpHeaders;
	body: string;
}

export interface HttpResponseMessage
{
	requestId: string;
	statusCode: number;
	headers: Record<string, string>;
	body: string;
}

export interface WsMessagePayload
{
	type: 'WS_MESSAGE';
	connectionId: string;
	payload: string;
}

export interface WsDisconnectMessage
{
	type: 'WS_DISCONNECT';
	connectionId: string;
}

export interface WsResponseMessage
{
	type: 'WS_RESPONSE';
	connectionId: string;
	payload: string;
}

export type WebWorkerIncomingMessage = HttpRequestMessage | WsMessagePayload | WsDisconnectMessage;
export type WebWorkerOutgoingMessage = HttpResponseMessage | WsResponseMessage;

// --- TCP / UDP Message Types ---
export interface TcpDataMessage
{
	type: 'TCP_DATA';
	socketId: string;
	payload: Uint8Array;
}

export interface TcpDisconnectMessage
{
	type: 'TCP_DISCONNECT';
	socketId: string;
}

export interface TcpResponseMessage
{
	type: 'TCP_RESPONSE';
	socketId: string;
	payload: Uint8Array | Buffer;
}

export interface UdpDataMessage
{
	type: 'UDP_DATA';
	packetId: string;
	rinfo: { address: string; port: number; };
	payload: Uint8Array;
}

export interface UdpResponseMessage
{
	type: 'UDP_RESPONSE';
	packetId: string;
	payload: Uint8Array | Buffer;
}

export type NetWorkerIncomingMessage = TcpDataMessage | TcpDisconnectMessage | UdpDataMessage;
export type NetWorkerOutgoingMessage = TcpResponseMessage | UdpResponseMessage;

// Subprocess Stub Interfaces
export interface HttpResponseStubResult
{
	statusCode: number;
	headers: Record<string, string>;
	body: string;
}

// Shared Service Ports
const HTTP_WS_PORT: number = 8080;
const TCP_PORT: number = 8050;
const UDP_PORT: number = 8060;

const NUM_WEB_WORKERS: number = 4;
const NUM_NET_WORKERS: number = 4;

if(isMainThread)
{
	// =========================================================================
	// PRIMARY THREAD: Central Router / Tunnel
	// =========================================================================

	const webWorkers: Worker[] = [];
	const netWorkers: Worker[] = [];
	let webRoundRobin: number = 0;
	let netRoundRobin: number = 0;

	console.log('[Primary] Initializing Worker Pools...');

	// 1. Spawn 4 HTTP + WS Worker Combos
	for(let i = 0; i < NUM_WEB_WORKERS; i++)
	{
		const workerDataPayload: WorkerDataPayload = { role: 'HTTP_WS_WORKER', id: i + 1 };
		const worker = new Worker(__filename, { workerData: workerDataPayload });
		webWorkers.push(worker);
	}

	// 2. Spawn 4 UDP + TCP Worker Combos
	for(let i = 0; i < NUM_NET_WORKERS; i++)
	{
		const workerDataPayload: WorkerDataPayload = { role: 'UDP_TCP_WORKER', id: i + 1 };
		const worker = new Worker(__filename, { workerData: workerDataPayload });
		netWorkers.push(worker);
	}

	// Helper: Round-robin selection
	const getNextWebWorker = (): Worker => webWorkers[webRoundRobin++ % webWorkers.length];
	const getNextNetWorker = (): Worker => netWorkers[netRoundRobin++ % netWorkers.length];

	// -------------------------------------------------------------------------
	// A. MAIN HTTP & WEBSOCKET ROUTER / TUNNEL
	// -------------------------------------------------------------------------
	const mainHttpServer: http.Server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) =>
	{
		const body: Buffer[] = [];
		req.on('data', (chunk: Buffer) => body.push(chunk)).on('end', () =>
		{
			const worker: Worker = getNextWebWorker();
			const requestId: string = Math.random().toString(36).substring(2, 10);

			const payload: HttpRequestMessage = {
				type: 'HTTP_REQUEST',
				requestId,
				method: req.method,
				url: req.url,
				headers: req.headers,
				body: Buffer.concat(body).toString('utf-8')
			};

			const handleResponse = (msg: HttpResponseMessage): void =>
			{
				if(msg.requestId === requestId)
				{
					worker.off('message', handleResponse);
					res.writeHead(msg.statusCode || 200, msg.headers || {});
					res.end(msg.body);
				}
			};

			worker.on('message', handleResponse);
			worker.postMessage(payload);
		});
	});

	const mainWss: WebSocketServer = new WebSocketServer({ server: mainHttpServer });

	mainWss.on('connection', (ws: WebSocket) =>
	{
		const worker: Worker = getNextWebWorker();
		const connectionId: string = Math.random().toString(36).substring(2, 10);

		ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) =>
		{
			const messagePayload: WsMessagePayload = {
				type: 'WS_MESSAGE',
				connectionId,
				payload: data.toString()
			};
			worker.postMessage(messagePayload);
		});

		const handleWsResponse = (msg: WsResponseMessage): void =>
		{
			if(msg.type === 'WS_RESPONSE' && msg.connectionId === connectionId)
			{
				ws.send(msg.payload);
			}
		};

		worker.on('message', handleWsResponse);

		ws.on('close', () =>
		{
			worker.off('message', handleWsResponse);
			const disconnectPayload: WsDisconnectMessage = { type: 'WS_DISCONNECT', connectionId };
			worker.postMessage(disconnectPayload);
		});
	});

	mainHttpServer.listen(HTTP_WS_PORT, () =>
	{
		console.log(`[Primary] Listening for HTTP & WS on port ${HTTP_WS_PORT}`);
	});

	// -------------------------------------------------------------------------
	// B. MAIN TCP ROUTER / TUNNEL
	// -------------------------------------------------------------------------
	const mainTcpServer: net.Server = net.createServer((socket: net.Socket) =>
	{
		const worker: Worker = getNextNetWorker();
		const socketId: string = Math.random().toString(36).substring(2, 10);

		socket.on('data', (data: Buffer) =>
		{
			const tcpPayload: TcpDataMessage = {
				type: 'TCP_DATA',
				socketId,
				payload: Uint8Array.from(data)
			};
			worker.postMessage(tcpPayload);
		});

		const handleTcpResponse = (msg: TcpResponseMessage): void =>
		{
			if(msg.type === 'TCP_RESPONSE' && msg.socketId === socketId)
			{
				socket.write(msg.payload);
			}
		};

		worker.on('message', handleTcpResponse);

		socket.on('close', () =>
		{
			worker.off('message', handleTcpResponse);
			const disconnectPayload: TcpDisconnectMessage = { type: 'TCP_DISCONNECT', socketId };
			worker.postMessage(disconnectPayload);
		});

		socket.on('error', (err: Error) => console.error('[Primary TCP Error]', err.message));
	});

	mainTcpServer.listen(TCP_PORT, () =>
	{
		console.log(`[Primary] Listening for TCP connections on port ${TCP_PORT}`);
	});

	// -------------------------------------------------------------------------
	// C. MAIN UDP ROUTER / TUNNEL
	// -------------------------------------------------------------------------
	const mainUdpSocket: dgram.Socket = dgram.createSocket('udp4');

	mainUdpSocket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) =>
	{
		const worker: Worker = getNextNetWorker();
		const packetId: string = Math.random().toString(36).substring(2, 10);

		const handleUdpResponse = (response: UdpResponseMessage): void =>
		{
			if(response.type === 'UDP_RESPONSE' && response.packetId === packetId)
			{
				worker.off('message', handleUdpResponse);
				mainUdpSocket.send(
					response.payload,
					rinfo.port,
					rinfo.address
				);
			}
		};

		worker.on('message', handleUdpResponse);

		const udpPayload: UdpDataMessage = {
			type: 'UDP_DATA',
			packetId,
			rinfo: { address: rinfo.address, port: rinfo.port },
			payload: Uint8Array.from(msg)
		};

		worker.postMessage(udpPayload);
	});

	mainUdpSocket.bind(UDP_PORT, () =>
	{
		console.log(`[Primary] Listening for UDP datagrams on port ${UDP_PORT}`);
	});

} else
{
	// =========================================================================
	// WORKER THREAD EXECUTION
	// =========================================================================
	const { role, id } = workerData as WorkerDataPayload;

	if(role === 'HTTP_WS_WORKER')
	{
		console.log(`[Worker ${id}] Ready for HTTP & WS tasks...`);

		parentPort?.on('message', (msg: WebWorkerIncomingMessage) =>
		{
			switch(msg.type)
			{
				case 'HTTP_REQUEST': {
					const response: HttpResponseStubResult = handleHttpRequestStub(msg, id);
					const outMsg: HttpResponseMessage = {
						requestId: msg.requestId,
						statusCode: response.statusCode,
						headers: response.headers,
						body: response.body
					};
					parentPort?.postMessage(outMsg);
					break;
				}

				case 'WS_MESSAGE': {
					const responsePayload: string = handleWsMessageStub(msg, id);
					const outMsg: WsResponseMessage = {
						type: 'WS_RESPONSE',
						connectionId: msg.connectionId,
						payload: responsePayload
					};
					parentPort?.postMessage(outMsg);
					break;
				}

				case 'WS_DISCONNECT': {
					handleWsDisconnectStub(msg.connectionId, id);
					break;
				}
			}
		});
	}

	if(role === 'UDP_TCP_WORKER')
	{
		console.log(`[Worker ${id}] Ready for UDP & TCP tasks...`);

		parentPort?.on('message', (msg: NetWorkerIncomingMessage) =>
		{
			switch(msg.type)
			{
				case 'TCP_DATA': {
					const responseBuffer: Uint8Array | Buffer = handleTcpDataStub(msg, id);
					const outMsg: TcpResponseMessage = {
						type: 'TCP_RESPONSE',
						socketId: msg.socketId,
						payload: responseBuffer
					};
					parentPort?.postMessage(outMsg);
					break;
				}

				case 'TCP_DISCONNECT': {
					handleTcpDisconnectStub(msg.socketId, id);
					break;
				}

				case 'UDP_DATA': {
					const responseBuffer: Uint8Array | Buffer = handleUdpDataStub(msg, id);
					const outMsg: UdpResponseMessage = {
						type: 'UDP_RESPONSE',
						packetId: msg.packetId,
						payload: responseBuffer
					};
					parentPort?.postMessage(outMsg);
					break;
				}
			}
		});
	}
}

// =============================================================================
// SUBPROCESS STUBS — WIRE YOUR CUSTOM FUNCTIONS HERE
// =============================================================================

function handleHttpRequestStub(msg: HttpRequestMessage, workerId: number): HttpResponseStubResult
{
	return {
		statusCode: 200,
		headers: { 'Content-Type': 'text/plain' },
		body: `[HTTP Worker ${workerId}] Handled ${msg.method} request for ${msg.url}`
	};
}

function handleWsMessageStub(msg: WsMessagePayload, workerId: number): string
{
	return `[WS Worker ${workerId} Echo]: ${msg.payload}`;
}

function handleWsDisconnectStub(connectionId: string, workerId: number): void
{
	// Cleanup logic for WS connection
}

function handleTcpDataStub(msg: TcpDataMessage, workerId: number): Uint8Array | Buffer
{
	const text: string = Buffer.from(msg.payload).toString('utf-8');
	return Buffer.from(`[TCP Worker ${workerId} Echo]: ${text}`);
}

function handleTcpDisconnectStub(socketId: string, workerId: number): void
{
	// Cleanup logic for TCP socket
}

function handleUdpDataStub(msg: UdpDataMessage, workerId: number): Uint8Array | Buffer
{
	const text: string = Buffer.from(msg.payload).toString('utf-8');
	return Buffer.from(`[UDP Worker ${workerId} Echo]: ${text}`);
}
