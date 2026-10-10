
/// <reference types="node" />
// @ts-check

const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const net = require('net');
const dgram = require('dgram');
const http = require('http');
const { WebSocketServer } = require('ws');
const { Server } = require('./socks.server.js');
const Stream = require('stream');
const { respondRequest, middleware } = require('./web-middle.js');
const startMasterServer = require('./master.js');

// =============================================================================
// JSDOC / TYPE ANNOTATIONS
// =============================================================================

/**
 * @typedef {'HTTP_WORKER' | 'NET_WORKER'} WorkerRole
 */

/**
 * @typedef {Object} WorkerDataPayload
 * @property {WorkerRole} role
 * @property {number} id
 */

/**
 * @typedef {Object} HttpRequestMessage
 * @property {'HTTP_REQUEST'} type
 * @property {string} requestId
 * @property {string} [method]
 * @property {string} [url]
 * @property {http.IncomingHttpHeaders} headers
 * @property {string | Buffer} body
 */

/**
 * @typedef {Object} HttpResponseMessage
 * @property {string} [requestId]
 * @property {number| undefined} [statusCode]
 * @property {Record<string, string> | undefined} [headers]
 * @property {string | Buffer | Stream} [body]
 */

/**
 * @typedef {Object} WsMessagePayload
 * @property {'WS_MESSAGE'} type
 * @property {string} connectionId
 * @property {string} payload
 */

/**
 * @typedef {Object} WsDisconnectMessage
 * @property {'WS_DISCONNECT'} type
 * @property {string} connectionId
 */

/**
 * @typedef {Object} WsResponseMessage
 * @property {'WS_RESPONSE'} type
 * @property {string} connectionId
 * @property {string} payload
 */

/**
 * @typedef {HttpRequestMessage | WsMessagePayload | WsDisconnectMessage} WebWorkerIncomingMessage
 */

/**
 * @typedef {Object} TcpDataMessage
 * @property {'TCP_DATA'} type
 * @property {string} socketId
 * @property {Uint8Array} payload
 */

/**
 * @typedef {Object} TcpDisconnectMessage
 * @property {'TCP_DISCONNECT'} type
 * @property {string} socketId
 */

/**
 * @typedef {Object} TcpResponseMessage
 * @property {'TCP_RESPONSE'} type
 * @property {string} socketId
 * @property {Uint8Array | Buffer} payload
 */

/**
 * @typedef {Object} UdpDataMessage
 * @property {'UDP_DATA'} type
 * @property {string} packetId
 * @property {{ address: string, port: number }} rinfo
 * @property {Uint8Array} payload
 */

/**
 * @typedef {Object} UdpResponseMessage
 * @property {'UDP_RESPONSE'} type
 * @property {string} packetId
 * @property {Uint8Array | Buffer} payload
 */

/**
 * @typedef {TcpDataMessage | TcpDisconnectMessage | UdpDataMessage} NetWorkerIncomingMessage
 */


// =============================================================================
// MAIN PORTS & CONFIGURATION
// =============================================================================

/** @type {number} */
const HTTP_WS_PORT = 4004;

/** @type {number} */
const UDP_PORT = 27950;

/** @type {number} */
const TCP_PORT = UDP_PORT;

/** @type {number} */
const NUM_WEB_WORKERS = 4;

/** @type {number} */
const NUM_NET_WORKERS = 4;

if(isMainThread)
{
	// =========================================================================
	// PRIMARY THREAD: Central Router / Tunnel
	// Handles initial network entry points and delegates payloads/jobs to workers
	// =========================================================================

	/** @type {Worker[]} */
	const webWorkers = [];

	/** @type {Worker[]} */
	const netWorkers = [];

	/** @type {number} */
	let webRoundRobin = 0;

	/** @type {number} */
	let netRoundRobin = 0;

	startMasterServer(UDP_PORT);

	console.log('[Primary] Initializing Worker Pools...');

	// 1. Spawn 4 HTTP + WS Worker Combos
	for(let i = 0; i < NUM_WEB_WORKERS; i++)
	{
		/** @type {WorkerDataPayload} */
		const workerDataPayload = { role: 'HTTP_WORKER', id: i + 1 };
		const worker = new Worker(__filename, { workerData: workerDataPayload });
		webWorkers.push(worker);
	}

	// 2. Spawn 4 UDP + TCP Worker Combos
	for(let i = 0; i < NUM_NET_WORKERS; i++)
	{
		/** @type {WorkerDataPayload} */
		const workerDataPayload = { role: 'NET_WORKER', id: i + 1 };
		const worker = new Worker(__filename, { workerData: workerDataPayload });
		netWorkers.push(worker);
	}

	/**
	 * Helper: Round-robin selection for Web workers
	 * @returns {Worker}
	 */
	const getNextWebWorker = () => webWorkers[webRoundRobin++ % webWorkers.length];

	/**
	 * Helper: Round-robin selection for Network workers
	 * @returns {Worker}
	 */
	const getNextNetWorker = () => netWorkers[netRoundRobin++ % netWorkers.length];

	// -------------------------------------------------------------------------
	// A. MAIN HTTP & WEBSOCKET ROUTER / TUNNEL
	// -------------------------------------------------------------------------
	/** @type {http.Server} */
	const mainHttpServer = http.createServer((req, res) =>
	{
		/** @type {Buffer[]} */
		let body = [];

		req.on('data', (/** @type {Buffer} */ chunk) => body.push(chunk)).on('end', () =>
		{
			const worker = getNextWebWorker();
			/** @type {string} */
			const requestId = Math.random().toString(36).substring(2, 10);

			/** @type {HttpRequestMessage} */
			const payload = {
				type: 'HTTP_REQUEST',
				requestId,
				method: req.method,
				url: req.url,
				headers: req.headers,
				body: Buffer.concat(body)
			};

			/**
			 * @param {HttpResponseMessage} msg
			 */
			const handleResponse = (msg) =>
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

	/** @type {InstanceType<typeof WebSocketServer>} */
	const mainWss = new WebSocketServer({ server: mainHttpServer });
	const socks = new Server;

	mainWss.on('connection', socks._onConnection.bind(socks));
	// (/** @type {import('ws').WebSocket} */ ws) =>
	// {
	// /** @type {Worker} */
	// const worker = getNextWebWorker();
	// /** @type {string} */
	// const connectionId = Math.random().toString(36).substring(2, 10);

	// // Tunnel incoming WS messages to worker
	// ws.on('message', (/** @type {Buffer | ArrayBuffer | Buffer[]} */ data) =>
	// {
	// 	/** @type {WsMessagePayload} */
	// 	const messagePayload = {
	// 		type: 'WS_MESSAGE',
	// 		connectionId,
	// 		payload: data.toString()
	// 	};
	// 	worker.postMessage(messagePayload);
	// });

	// // Listen for responses back from worker intended for this WS client
	// /**
	//  * @param {WsResponseMessage} msg
	//  */
	// const handleWsResponse = (msg) =>
	// {
	// 	if(msg.type === 'WS_RESPONSE' && msg.connectionId === connectionId)
	// 	{
	// 		ws.send(msg.payload);
	// 	}
	// };

	// worker.on('message', handleWsResponse);

	// ws.on('close', () =>
	// {
	// 	worker.off('message', handleWsResponse);
	// 	/** @type {WsDisconnectMessage} */
	// 	const disconnectPayload = { type: 'WS_DISCONNECT', connectionId };
	// 	worker.postMessage(disconnectPayload);
	// });
	// });

	mainHttpServer.listen(HTTP_WS_PORT, () =>
	{
		console.log(`[Primary] Listening for HTTP & WS on port ${HTTP_WS_PORT}`);
	});

	// -------------------------------------------------------------------------
	// B. MAIN TCP ROUTER / TUNNEL
	// -------------------------------------------------------------------------
	/** @type {net.Server} */
	// const mainTcpServer = net.createServer((/** @type {net.Socket} */ socket) =>
	// {
	// 	const worker = getNextNetWorker();
	// 	/** @type {string} */
	// 	const socketId = Math.random().toString(36).substring(2, 10);

	// 	socket.on('data', (/** @type {Buffer} */ data) =>
	// 	{
	// 		/** @type {TcpDataMessage} */
	// 		const tcpPayload = {
	// 			type: 'TCP_DATA',
	// 			socketId,
	// 			payload: Uint8Array.from(data)
	// 		};
	// 		worker.postMessage(tcpPayload);
	// 	});

	// 	/**
	// 	 * @param {TcpResponseMessage} msg
	// 	 */
	// 	const handleTcpResponse = (msg) =>
	// 	{
	// 		if(msg.type === 'TCP_RESPONSE' && msg.socketId === socketId)
	// 		{
	// 			socket.write(msg.payload);
	// 		}
	// 	};

	// 	worker.on('message', handleTcpResponse);

	// 	socket.on('close', () =>
	// 	{
	// 		worker.off('message', handleTcpResponse);
	// 		/** @type {TcpDisconnectMessage} */
	// 		const disconnectPayload = { type: 'TCP_DISCONNECT', socketId };
	// 		worker.postMessage(disconnectPayload);
	// 	});

	// 	socket.on('error', (/** @type {Error} */ err) => console.error('[Primary TCP Error]', err.message));
	// });

	// mainTcpServer.listen(TCP_PORT, () =>
	// {
	// 	console.log(`[Primary] Listening for TCP connections on port ${TCP_PORT}`);
	// });

	// -------------------------------------------------------------------------
	// C. MAIN UDP ROUTER / TUNNEL
	// -------------------------------------------------------------------------
	/** @type {dgram.Socket} */
	// const mainUdpSocket = dgram.createSocket('udp4');

	// mainUdpSocket.on('message', (/** @type {Buffer} */ msg, /** @type {dgram.RemoteInfo} */ rinfo) =>
	// {
	// 	const worker = getNextNetWorker();
	// 	/** @type {string} */
	// 	const packetId = Math.random().toString(36).substring(2, 10);

	// 	/**
	// 	 * @param {UdpResponseMessage} response
	// 	 */
	// 	const handleUdpResponse = (response) =>
	// 	{
	// 		if(response.type === 'UDP_RESPONSE' && response.packetId === packetId)
	// 		{
	// 			worker.off('message', handleUdpResponse);
	// 			mainUdpSocket.send(
	// 				response.payload,
	// 				rinfo.port,
	// 				rinfo.address
	// 			);
	// 		}
	// 	};

	// 	worker.on('message', handleUdpResponse);

	// 	/** @type {UdpDataMessage} */
	// 	const udpPayload = {
	// 		type: 'UDP_DATA',
	// 		packetId,
	// 		rinfo: { address: rinfo.address, port: rinfo.port },
	// 		payload: Uint8Array.from(msg)
	// 	};

	// 	worker.postMessage(udpPayload);
	// });

	// mainUdpSocket.bind(UDP_PORT, () =>
	// {
	// 	console.log(`[Primary] Listening for UDP datagrams on port ${UDP_PORT}`);
	// });

} else
{
	// =========================================================================
	// WORKER THREAD EXECUTION
	// =========================================================================

	/** @type {WorkerDataPayload} */
	const { role, id } = workerData;

	if(role === 'HTTP_WORKER')
	{
		console.log(`[Worker ${id}] Ready for HTTP & WS tasks...`);

		parentPort?.on('message', async (/** @type {WebWorkerIncomingMessage} */ msg) =>
		{
			switch(msg.type)
			{
				case 'HTTP_REQUEST': {
					const response = await handleHttpRequestStub(msg, id);
					parentPort?.postMessage({
						requestId: msg.requestId,
						statusCode: response.statusCode,
						headers: response.headers,
						body: response.body
					});
					break;
				}

				case 'WS_MESSAGE': {
					const responsePayload = handleWsMessageStub(msg, id);
					parentPort?.postMessage({
						type: 'WS_RESPONSE',
						connectionId: msg.connectionId,
						payload: responsePayload
					});
					break;
				}

				case 'WS_DISCONNECT': {
					handleWsDisconnectStub(msg.connectionId, id);
					break;
				}
			}
		});
	}

	if(role === 'NET_WORKER')
	{
		console.log(`[Worker ${id}] Ready for UDP & TCP tasks...`);

		parentPort?.on('message', (/** @type {NetWorkerIncomingMessage} */ msg) =>
		{
			switch(msg.type)
			{
				case 'TCP_DATA': {
					const responseBuffer = handleTcpDataStub(msg, id);
					parentPort?.postMessage({
						type: 'TCP_RESPONSE',
						socketId: msg.socketId,
						payload: responseBuffer
					});
					break;
				}

				case 'TCP_DISCONNECT': {
					handleTcpDisconnectStub(msg.socketId, id);
					break;
				}

				case 'UDP_DATA': {
					const responseBuffer = handleUdpDataStub(msg, id);
					parentPort?.postMessage({
						type: 'UDP_RESPONSE',
						packetId: msg.packetId,
						payload: responseBuffer
					});
					break;
				}
			}
		});
	}
}

// =============================================================================
// SUBPROCESS STUBS — WIRE YOUR CUSTOM FUNCTIONS HERE
// =============================================================================

/**
 * @param {HttpRequestMessage} msg
 * @param {number} workerId
 * @returns {Promise<HttpResponseMessage>}
 */
async function handleHttpRequestStub(msg, workerId)
{
	// return {
	// 	statusCode: 200,
	// 	headers: { 'Content-Type': 'text/plain' },
	// 	body: `[HTTP Worker ${workerId}] Handled ${msg.method} request for ${msg.url}`
	// };

	const pre = middleware(msg);
	if(msg.method === 'OPTIONS')
	{
		return pre;
	}

	/** @type {HttpResponseMessage} */
	const response = await respondRequest(msg);
	if(typeof response === 'object')
	{
		Object.assign(response.headers ?? {}, pre.headers);
	}
	return response;
}

/**
 * @param {WsMessagePayload} msg
 * @param {number} workerId
 * @returns {string}
 */
function handleWsMessageStub(msg, workerId)
{
	return `[WS Worker ${workerId} Echo]: ${msg.payload}`;
}

/**
 * @param {string} connectionId
 * @param {number} workerId
 * @returns {void}
 */
function handleWsDisconnectStub(connectionId, workerId)
{
	// Cleanup logic
}

/**
 * @param {TcpDataMessage} msg
 * @param {number} workerId
 * @returns {Uint8Array | Buffer}
 */
function handleTcpDataStub(msg, workerId)
{
	const text = Buffer.from(msg.payload).toString('utf-8');
	return Buffer.from(`[TCP Worker ${workerId} Echo]: ${text}`);
}

/**
 * @param {string} socketId
 * @param {number} workerId
 * @returns {void}
 */
function handleTcpDisconnectStub(socketId, workerId)
{
	// Cleanup logic
}

/**
 * @param {UdpDataMessage} msg
 * @param {number} workerId
 * @returns {Uint8Array | Buffer}
 */
function handleUdpDataStub(msg, workerId)
{
	const text = Buffer.from(msg.payload).toString('utf-8');
	return Buffer.from(`[UDP Worker ${workerId} Echo]: ${text}`);
}
