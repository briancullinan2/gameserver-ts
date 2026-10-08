const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const net = require('net');
const dgram = require('dgram');
const http = require('http');
const { WebSocketServer } = require('ws');
const os = require('os');

// Configuration Ports
const TCP_PORT = 8050;
const UDP_PORT = 8060;
const WS_PORT = 8070;

if(isMainThread)
{
	// =========================================================================
	// PRIMARY THREAD: Allocates Port Handles and Dispatches to Thread Pool
	// =========================================================================
	const numThreads = Math.min(os.cpus().length, 4);
	console.log(`[Primary] Spawning ${numThreads} network worker threads...`);

	const workers = [];
	let rrCounter = 0; // Simple Round-Robin Load-Balancer Counter

	// Initialize Worker Threads
	for(let i = 0; i < numThreads; i++)
	{
		const worker = new Worker(__filename, { workerData: { threadId: i + 1 } });
		workers.push(worker);
	}

	// 1. TCP SERVER (Router)
	const tcpServer = net.createServer({ pauseOnConnect: true }, (socket) =>
	{
		// Round-robin load balancing
		const targetWorker = workers[rrCounter % numThreads];
		rrCounter++;

		// Pass the raw socket handle to the chosen worker thread
		targetWorker.postMessage({ type: 'TCP_CONN' }, socket);
	});
	tcpServer.listen(TCP_PORT, () => console.log(`[Primary] TCP Router listening on port ${TCP_PORT}`));

	// 2. UDP SOCKET (Router)
	const udpSocket = dgram.createSocket('udp4');
	udpSocket.on('message', (msg, rinfo) =>
	{
		const targetWorker = workers[rrCounter % numThreads];
		rrCounter++;

		// UDP is connectionless; we must forward the buffer data along with sender info
		targetWorker.postMessage({
			type: 'UDP_PACKET',
			payload: msg,
			rinfo: rinfo
		});
	});
	udpSocket.bind(UDP_PORT, () => console.log(`[Primary] UDP Router listening on port ${UDP_PORT}`));

	// 3. WEBSOCKET SERVER (Router)
	const httpServer = http.createServer();
	const wss = new WebSocketServer({ noServer: true });

	httpServer.on('upgrade', (request, socket, head) =>
	{
		// Handle WebSocket handshake interception safely on Primary
		wss.handleUpgrade(request, socket, head, (ws) =>
		{
			const targetWorker = workers[rrCounter % numThreads];
			rrCounter++;

			// Pause the socket to prevent data loss before the thread hooks into it
			socket.pause();

			// Pass the upgraded stream underlying socket handle straight down
			targetWorker.postMessage({ type: 'WS_CONN' }, socket);
		});
	});
	httpServer.listen(WS_PORT, () => console.log(`[Primary] WebSocket Router listening on port ${WS_PORT}`));

} else
{
	// =========================================================================
	// WORKER THREAD: Handles Isolated Processing Tasks in Parallel
	// =========================================================================
	const { threadId } = workerData;
	const WebSocket = require('ws');

	// Create an un-bound UDP socket to send responses back to clients natively
	const workerUdpSocket = dgram.createSocket('udp4');

	parentPort.on('message', (message, socketHandle) =>
	{

		// --- HANDLE INTERCEPTED TCP CONNECTION ---
		if(message.type === 'TCP_CONN' && socketHandle)
		{
			socketHandle.resume(); // Resume stream processing inside this thread context
			console.log(`[Thread ${threadId}] Processing incoming TCP connection`);

			socketHandle.on('data', (data) =>
			{
				socketHandle.write(`[Thread ${threadId} Echo]: ${data}`);
			});
			socketHandle.on('error', (err) => console.error(`[Thread ${threadId} TCP Error]`, err.message));
		}

		// --- HANDLE INTERCEPTED UDP BUFFER ---
		if(message.type === 'UDP_PACKET')
		{
			const { payload, rinfo } = message;
			console.log(`[Thread ${threadId}] Processing UDP payload from ${rinfo.address}:${rinfo.port}`);

			// Echo response payload directly back via worker's internal outbound handle
			const response = Buffer.from(`[Thread ${threadId} UDP Echo]: ${payload.toString()}`);
			workerUdpSocket.send(response, 0, response.length, rinfo.port, rinfo.address);
		}

		// --- HANDLE INTERCEPTED WEBSOCKET UPGRADE ---
		if(message.type === 'WS_CONN' && socketHandle)
		{
			// Re-instantiate the WebSocket context inside the worker using the shared pipeline handle
			const ws = new WebSocket(null);
			ws.setSocket(socketHandle, Buffer.alloc(0), {
				clientTracking: false,
				maxPayload: 100 * 1024 * 1024
			});

			socketHandle.resume(); // Re-activate stream parsing after attachment completes
			console.log(`[Thread ${threadId}] Processing incoming WebSocket connection`);

			ws.on('message', (data) =>
			{
				ws.send(`[Thread ${threadId} WS Echo]: ${data}`);
			});
			ws.on('error', (err) => console.error(`[Thread ${threadId} WS Error]`, err.message));
		}
	});
}
