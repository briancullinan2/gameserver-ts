import type { LuminoLayoutWindow } from "../bundle/lumino.d";
import type { GlobalToolbarsWindow } from "../bundle/menu.d";
import type { Q3NetworkConfig, ServerEntry } from "./widget";
import { ISignal, Signal } from '@lumino/signaling';

export interface ISocketMessage
{
	address: string;
	port?: number;
	data: Uint8Array;
}

const widgetSelf: LuminoLayoutWindow & GlobalToolbarsWindow & {
	WebSocketMonitor: typeof WebSocketMonitor;
} = self as unknown as any;

export class WebSocketMonitor
{
	static socket1?: WebSocket | null;
	static socket2?: WebSocket | null;
	static heartbeatTimer: ReturnType<typeof setTimeout> | undefined;

	// SOCKS5 WebSockets Duplexing Engine
	public static netConfig: Q3NetworkConfig = {
		socksServer: window.location.hostname || 'localhost',
		socksPort: parseInt(window.location.port || '8080', 10),
		netPort: 27960,
	};
	static reconnect: boolean = false;
	static _websocketState?: HTMLDivElement;
	static packetQueue: Array<{ addr: string; port: number[]; data: Uint8Array; }> = [];

	private static _serverResponse: Signal<any, ISocketMessage> = new Signal<any, ISocketMessage>(this);
	public static previousError?: Date;
	static queue: any = [];
	static queueFrame: NodeJS.Timeout;

	public static get serverResponse(): ISignal<any, ISocketMessage>
	{
		return this._serverResponse;
	}

	/* ------------------------------------------------------------------ */
	/* SOCKS5 Protocol Networking & Auto-Reconnect                        */
	/* ------------------------------------------------------------------ */
	public static initQ3Socks5Networking(config?: Q3NetworkConfig): void
	{
		if(config)
		{
			this.netConfig = config;
		}

		const protocol = this.netConfig.socksPort === 443 ? 'wss' : 'ws';
		const fullAddress = `${protocol}://${this.netConfig.socksServer}:${this.netConfig.socksPort}`;

		console.log(`[WSMonitor] Initializing connection to ${fullAddress}...`);

		try
		{
			// Clean up socket1 if dead
			if(this.socket1 && (this.socket1.readyState === WebSocket.CLOSED || this.socket1.readyState === WebSocket.CLOSING))
			{
				console.warn('[WSMonitor] Cleaning up stale socket1 reference');
				this.socket1 = null;
			}

			if(!this.socket1)
			{
				console.log('[WSMonitor] Connecting socket1...');
				this.socket1 = new WebSocket(fullAddress);
				this.socket1.binaryType = 'arraybuffer';
				this.socket1.addEventListener('open', (e) => this.onSocketOpen(e));
				this.socket1.addEventListener('message', (e) => this.onSocketMessage(e));
				this.socket1.addEventListener('error', (e) => this.onSocketError(e));
				this.socket1.addEventListener('close', (e) => this.onSocketClose(e));
			}

			// Clean up socket2 if dead
			if(this.socket2 && (this.socket2.readyState === WebSocket.CLOSED || this.socket2.readyState === WebSocket.CLOSING))
			{
				console.warn('[WSMonitor] Cleaning up stale socket2 reference');
				this.socket2 = null;
			}

			if(!this.socket2)
			{
				console.log('[WSMonitor] Connecting socket2...');
				this.socket2 = new WebSocket(fullAddress);
				this.socket2.binaryType = 'arraybuffer';
				this.socket2.addEventListener('open', (e) => this.onSocketOpen(e));
				this.socket2.addEventListener('message', (e) => this.onSocketMessage(e));
				this.socket2.addEventListener('error', (e) => this.onSocketError(e));
				this.socket2.addEventListener('close', (e) => this.onSocketClose(e));
			}

			if(!this.heartbeatTimer)
			{
				console.log('[WSMonitor] Starting 9s heartbeat interval timer');
				this.heartbeatTimer = setInterval(() => this.sendHeartbeats(), 9000);
				this.queueFrame = setInterval(() => this.clearFrameQueue(), 15);
			}

			// Update UI status item
			if(!this._websocketState)
			{
				this._websocketState = widgetSelf.statusBar?.node.querySelector('#status-item-ws-state') as HTMLDivElement;
			}
			if(!this._websocketState)
			{
				this._websocketState = widgetSelf.statusBar?.addStatusItem('ws-state', '[WS] Loading', 'bx bx-radio-circle', 'right');
			}

		} catch(err)
		{
			console.error('[WSMonitor] Failed to initialize SOCKS5 WebSockets:', err);
		}
	}


	private static clearFrameQueue()
	{
		const socketsWorking = (this.socket1 && this.socket1.readyState === WebSocket.OPEN && (this.socket1 as any).fresh >= 3)
			|| (this.socket2 && this.socket2.readyState === WebSocket.OPEN && (this.socket2 as any).fresh >= 3);

		if(!socketsWorking)
		{
			return;
		}

		const oldQueue = this.queue;
		this.queue = [];

		for(const msgArgs of oldQueue ?? [])
		{
			this.sendQ3UDPMessage.apply(this, msgArgs);
		}
	}


	private static onSocketError(evt: Event): void
	{
		const ws = evt.target as WebSocket;
		const tag = ws === this.socket1 ? 'socket1' : ws === this.socket2 ? 'socket2' : 'unknown';

		console.error(`[WSMonitor] ${tag} encountered an error:`, evt);
		this.previousError = new Date();
		this.reconnect = true;

		if(ws === this.socket1) this.socket1 = null;
		if(ws === this.socket2) this.socket2 = null;

		this.updateStatusUI('[WS] Error', 'bx bx-error-circle');
	}

	private static onSocketClose(evt: CloseEvent): void
	{
		const ws = evt.target as WebSocket;
		const tag = ws === this.socket1 ? 'socket1' : ws === this.socket2 ? 'socket2' : 'unknown';

		console.warn(`[WSMonitor] ${tag} closed (Code: ${evt.code}, Reason: "${evt.reason || 'none'}")`);
		this.reconnect = true;

		if(ws === this.socket1) this.socket1 = null;
		if(ws === this.socket2) this.socket2 = null;

		this.updateStatusUI('[WS] Disconnected', 'bx bx-x-circle');
	}

	private static onSocketOpen(evt: Event): void
	{
		const ws = evt.target as any;
		const tag = ws === this.socket1 ? 'socket1' : ws === this.socket2 ? 'socket2' : 'unknown';
		console.log(`[WSMonitor] ${tag} connected. Initiating SOCKS5 handshake...`);

		ws.fresh = 1;
		// Step 1: SOCKS5 Handshake (No Auth)
		ws.send(Uint8Array.from([0x05, 0x01, 0x00]));

		if(!this.heartbeatTimer)
		{
			this.heartbeatTimer = setInterval(() => this.sendHeartbeats(), 9000);
		}

		if(this.reconnect)
		{
			console.log(`[WSMonitor] Sending Emscripten port message on reconnected ${tag}`);
			this.sendEmscriptenPortMessage(evt.target as WebSocket, this.netConfig.netPort);
		}
	}

	private static onSocketMessage(evt: MessageEvent): void
	{
		const ws = evt.target as any;
		const tag = ws === this.socket1 ? 'socket1' : ws === this.socket2 ? 'socket2' : 'unknown';

		if(typeof evt.data === 'string')
		{
			debugger;
			return;
		} else
		{

		}
		const message = new Uint8Array(evt.data);

		switch(ws.fresh)
		{
			case 1:
				if(message.length === 2 && message[1] === 0x00)
				{
					console.log(`[WSMonitor] ${tag} SOCKS5 Auth OK. Sending UDP Associate request...`);
					// Step 2: UDP Associate Request
					ws.send(Uint8Array.from([
						0x05, 0x03, 0x00, 0x01,
						0x00, 0x00, 0x00, 0x00,
						(this.netConfig.netPort & 0xFF00) >> 8, (this.netConfig.netPort & 0xFF)
					]));
					ws.fresh = 2;
				} else
				{
					console.error(`[WSMonitor] ${tag} SOCKS5 Auth Failed:`, message);
				}
				break;

			case 2:
				// SOCKS5 UDP Associate Response (10 bytes: [0x05, 0x00, 0x00, 0x01, IP(4), PORT(2)])
				if(message.length === 10 && message[0] === 0x05 && message[1] === 0x00)
				{
					console.log(`[WSMonitor] ${tag} UDP Associated. Performing Emscripten Port Handshake...`);
					this.sendEmscriptenPortMessage(ws, this.netConfig.netPort);
					this.updateStatusUI('[WS] Active', 'bx bx-circle-marked');
					ws.fresh = 3;
				} else
				{
					console.error(`[WSMonitor] ${tag} SOCKS5 UDP Associate failed:`, message);
				}
				break;

			case 3:
				if(message.length === 10)
				{
					this.netConfig.assignedPort = (message[9] << 8) + message[8];
					console.log(`[WSMonitor] ${tag} Handshake acknowledged by bridge, assigned port: ${this.netConfig.assignedPort}`);
					ws.fresh = 4;
					// this.registerGameServer(this.netConfig.netPort);
					return; // FIX: Return here to prevent fallthrough to case 4/5!
				}
				return;

			case 4:
			case 5:
				if(message.length <= 10) return;

				let addrStr = '';
				let remotePort = 0;
				let msgData: Uint8Array;

				if(message[3] === 1)
				{
					// IPv4 Address
					addrStr = `${message[4]}.${message[5]}.${message[6]}.${message[7]}`;
					remotePort = (message[8] << 8) | message[9]; // Big Endian match
					msgData = message.slice(10);
				} else if(message[3] === 3)
				{
					// Domain Name
					const domainLen = message[4];
					addrStr = Array.from(message.slice(5, 5 + domainLen)) // FIX: Removed '- 1'
						.map(c => String.fromCharCode(c))
						.join('');

					const portOffset = 5 + domainLen;
					remotePort = (message[portOffset] << 8) | message[portOffset + 1];
					msgData = message.slice(portOffset + 2);
				} else
				{
					console.warn(`[WSMonitor] ${tag} received unsupported ATYP: ${message[3]}`);
					return;
				}

				// INTERCEPT COMMAND REQUESTS (e.g., getstatus)
				if(this.handleInboundQ3Command(addrStr.trim(), remotePort, msgData))
				{
					return; // Intercepted and answered internally
				}

				this._serverResponse.emit({
					address: addrStr.trim(),
					port: remotePort,
					data: msgData
				});
				break;
		}
	}



	public static sendHTTPRequest(targetAddr: string, port: number, payload: string)
	{
		return this.sendQ3UDPMessage(targetAddr, port, payload, true, 0x05);
	}


	public static sendQ3UDPMessage(targetAddr: string, port: number, payload: string, stripOOB?: boolean, type?: number): void
	{
		const payloadBytes = new TextEncoder().encode(payload);
		const header = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);
		const fullPayload = new Uint8Array(
			(stripOOB !== true ? header.length : 0) + payloadBytes.length);
		if(stripOOB !== true)
		{
			fullPayload.set(header, 0);
			fullPayload.set(payloadBytes, 4);
		} else
		{
			fullPayload.set(payloadBytes, 0);
		}

		// Frame SOCKS5 UDP Packet
		const nameLen = targetAddr.length;
		const packet = new Uint8Array(4 + 1 + nameLen + 2 + fullPayload.length);
		packet[0] = 0x00;
		packet[1] = type ?? 0x00;
		packet[2] = 0x00;
		packet[3] = 0x03; // Domain name addressing
		packet[4] = nameLen;
		for(let i = 0; i < nameLen; i++) packet[5 + i] = targetAddr.charCodeAt(i);
		packet[5 + nameLen] = (port & 0xFF00) >> 8;
		packet[5 + nameLen + 1] = port & 0xFF;
		packet.set(fullPayload, 5 + nameLen + 2);

		let any = false;
		if(this.socket1 && this.socket1.readyState === WebSocket.OPEN && (this.socket1 as any).fresh >= 3)
		{
			this.socket1.send(packet);
			any = true;
		}
		if(this.socket2 && this.socket2.readyState === WebSocket.OPEN && (this.socket2 as any).fresh >= 3)
		{
			this.socket2.send(packet);
			any = true;
		}
		if(!any)
		{
			this.queue.push([targetAddr, port, payload, stripOOB, type]);
			console.warn('[WSMonitor] No active socket ready to send packet. Attempting reconnect...');
			this.initQ3Socks5Networking();
		}
	}

	public static sendHeartbeats(): void
	{
		console.log('[WSMonitor] Heartbeat tick...');

		const checkAndHeartbeat = (sock: WebSocket | null | undefined, name: string) =>
		{
			if(sock && sock.readyState === WebSocket.OPEN && (sock as any).fresh >= 3)
			{
				sock.send(Uint8Array.from([0x05, 0x01, 0x00, 0x00]));
			} else
			{
				console.warn(`[WSMonitor] Heartbeat check failed for ${name} (readyState: ${sock ? sock.readyState : 'null'}). Triggering reconnect...`);
			}
		};

		checkAndHeartbeat(this.socket1, 'socket1');
		checkAndHeartbeat(this.socket2, 'socket2');

		// Re-initialize if either socket is missing or closed
		if(!this.socket1 || !this.socket2 ||
			this.socket1.readyState >= WebSocket.CLOSING ||
			this.socket2.readyState >= WebSocket.CLOSING)
		{
			console.log('[WSMonitor] Re-initializing dead sockets during heartbeat tick');
			this.initQ3Socks5Networking();
		}
	}

	public static shutdownNetworking(): void
	{
		console.log('[WSMonitor] Shutting down networking...');
		if(this.heartbeatTimer) clearInterval(this.heartbeatTimer);
		if(this.socket1) this.socket1.close();
		if(this.socket2) this.socket2.close();
		this.socket1 = null;
		this.socket2 = null;
		this.heartbeatTimer = undefined;
	}

	private static sendEmscriptenPortMessage(socket: WebSocket, port: number): void
	{
		socket.send(Uint8Array.from([
			0xFF, 0xFF, 0xFF, 0xFF,
			'p'.charCodeAt(0), 'o'.charCodeAt(0), 'r'.charCodeAt(0), 't'.charCodeAt(0),
			(port & 0xFF00) >> 8, (port & 0xFF)
		]));
	}

	private static updateStatusUI(label: string, iconClass: string): void
	{
		widgetSelf.statusBar?.updateStatusItem('ws-state', label);
		const stateNode = this._websocketState?.querySelector('i');
		if(stateNode)
		{
			stateNode.className = iconClass;
		}
	}

	/**
	 * Intercepts inbound master server and client queries (e.g. getstatus)
	 * and manufactures a detailed server status payload.
	 */
	private static handleInboundQ3Command(senderAddr: string, senderPort: number, data: Uint8Array): boolean
	{
		// Check for standard OOB header 0xFFFFFFFF
		if(data.length < 5 || data[0] !== 0xFF || data[1] !== 0xFF || data[2] !== 0xFF || data[3] !== 0xFF)
		{
			return false;
		}

		const commandText = new TextDecoder().decode(data.slice(4)).trim();

		if(commandText.startsWith('getstatus'))
		{
			console.log(`[WSMonitor] Intercepted 'getstatus' from ${senderAddr}:${senderPort}. Generating manufactured response...`);
			this.respondGetStatus(senderAddr, senderPort);
			return true;
		} else if(commandText.startsWith('getinfo'))
		{
			console.log(`[WSMonitor] Intercepted 'getinfo' from ${senderAddr}:${senderPort}. Generating info response...`);
			this.respondGetInfo(senderAddr, senderPort);
			return true;
		}

		return false;
	}



	/**
	 * Manufactures a beautiful, highly detailed Q3 server status response.
	 */
	public static respondGetStatus(targetAddr: string, port: number): void
	{
		// Extract current map from client window.location
		let currentMap = window.location.pathname.replace(/^\/|\/$/g, '').replace(/[^a-zA-Z0-9_\-]/g, '_');
		if(!currentMap || currentMap === '')
		{
			currentMap = 'q3dm17'; // Fallback default map name
		}

		const hostName = document.title || 'Browser Quake3 Web Node';
		const webSite = window.location.origin + window.location.pathname;

		// Build Quake3 statusResponse key-value pairs
		const serverVars: Record<string, string> = {
			"gamename": "q3a",
			"g_gametype": "0",
			"net_port": String(this.netConfig.netPort),
			"hostname": hostName,
			"mapname": currentMap,
			"clients": "1",
			"sv_maxclients": "16",
			"version": "Q3 1.32b web-browser",
			"g_needpass": "0",
			"sv_allowDownload": "1",
			"web_site": webSite,
			"hosting_provider": "Lumino WebSockets Proxy Engine",
			"location": window.location.hostname
		};

		// Format into valid Quake 3 info string: \key1\val1\key2\val2
		const formattedVars = Object.entries(serverVars)
			.map(([k, v]) => `${k}\\${v}`)
			.join('\\');

		let statusString = `statusResponse\n\\${formattedVars}\n`;

		// Add dummy/active player list: "score ping name"
		statusString += `0 15 "^2WebPlayer^7"\n`;

		requestAnimationFrame(() =>
		{
			this.sendQ3UDPMessage(targetAddr, port, statusString);
		});
	}

	/**
	 * Manufactures getinfo response for quick ping / server browser scanning.
	 */
	public static respondGetInfo(targetAddr: string, port: number): void
	{
		let currentMap = window.location.pathname.replace(/^\/|\/$/g, '').replace(/[^a-zA-Z0-9_\-]/g, '_');
		if(!currentMap || currentMap === '') currentMap = 'q3dm17';

		const hostName = document.title || 'Browser Quake3 Web Node';

		const infoVars: Record<string, string> = {
			"gamename": "q3a",
			"hostname": hostName,
			"mapname": currentMap,
			"clients": "1",
			"sv_maxclients": "16",
			"game": "baseq3",
			"g_gametype": "0",
			"g_needpass": "0"
		};

		// Format into valid Quake 3 info string: \key1\val1\key2\val2
		const formattedVars = Object.entries(infoVars)
			.map(([k, v]) => `${k}\\${v}`)
			.join('\\');

		const infoString = `infoResponse\n\\${formattedVars}`;

		requestAnimationFrame(() =>
		{
			this.sendQ3UDPMessage(targetAddr, port, infoString);
		});
	}



}

widgetSelf.WebSocketMonitor = WebSocketMonitor;
widgetSelf.WebSocketMonitor.initQ3Socks5Networking();
