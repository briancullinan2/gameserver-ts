import type { LuminoLayoutWindow } from "../bundle/lumino.d";
import type { Q3NetworkConfig } from "./widget";
import { ISignal, Signal } from '@lumino/signaling';

export interface ISocketMessage
{
	address: string;
	port?: number;
	data: Uint8Array;
}

const widgetSelf: LuminoLayoutWindow & {
	WebSocketMonitor: typeof WebSocketMonitor;
} = self as unknown as any;

export class WebSocketMonitor
{
	static socket1?: WebSocket | null;
	static socket2?: WebSocket | null;
	static heartbeatTimer: ReturnType<typeof setTimeout> | undefined;

	// SOCKS5 WebSockets Duplexing Engine
	static netConfig: Q3NetworkConfig = {
		socksServer: window.location.hostname || 'localhost',
		socksPort: parseInt(window.location.port || '8080', 10),
		netPort: 27960
	};
	static reconnect: boolean = false;
	static _websocketState?: HTMLDivElement;
	static packetQueue: Array<{ addr: string; port: number[]; data: Uint8Array; }> = [];

	private static _serverResponse: Signal<any, ISocketMessage> = new Signal<any, ISocketMessage>(this);
	public static previousError?: Date;

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

	private static onSocketError(evt: Event): void
	{
		const ws = evt.target as WebSocket;
		const tag = ws === this.socket1 ? 'socket1' : ws === this.socket2 ? 'socket2' : 'unknown';

		console.error(`[WSMonitor] ${tag} encounter error:`, evt);
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

		if(typeof evt.data === 'string') return;
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
				console.log(`[WSMonitor] ${tag} UDP Associated. Performing Emscripten Port Handshake...`);
				// Step 3: Emscripten Bridge Port Handshake
				this.sendEmscriptenPortMessage(ws, this.netConfig.netPort);
				this.updateStatusUI('[WS] Active', 'bx bx-circle-marked');
				ws.fresh = 3;
				break;

			case 3:
				if(message.length === 10)
				{
					console.log(`[WSMonitor] ${tag} Handshake acknowledged by bridge`);
					ws.fresh = 4;
					break;
				}
			case 4:
			case 5:
				if(message.length <= 10) return;

				// Decode incoming Q3 SOCKS5 packet
				let addrStr = '';
				let remotePort = 0;
				let msgData: Uint8Array;

				if(message[3] === 1)
				{
					// IPv4
					addrStr = `${message[4]}.${message[5]}.${message[6]}.${message[7]}`;
					remotePort = (message[8] << 8) | message[9];
					msgData = message.slice(10);
				} else if(message[3] === 3)
				{
					// Domain
					const domainLen = message[4];
					addrStr = Array.from(message.slice(5, 5 + domainLen - 1))
						.map(c => String.fromCharCode(c))
						.join('');

					const portOffset = 5 + domainLen;
					remotePort = (message[portOffset] << 8) | message[portOffset + 1];
					msgData = message.slice(portOffset + 2);
				} else
				{
					console.warn(`[WSMonitor] ${tag} received unsupported address type: ${message[3]}`);
					return;
				}

				this._serverResponse.emit({
					address: addrStr.trim(),
					port: remotePort,
					data: msgData
				});
				break;
		}
	}

	public static sendQ3UDPMessage(targetAddr: string, port: number, payload: string): void
	{
		const payloadBytes = new TextEncoder().encode(payload);
		const header = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);
		const fullPayload = new Uint8Array(header.length + payloadBytes.length);
		fullPayload.set(header, 0);
		fullPayload.set(payloadBytes, 4);

		// Frame SOCKS5 UDP Packet
		const nameLen = targetAddr.length;
		const packet = new Uint8Array(4 + 1 + nameLen + 2 + fullPayload.length);
		packet[0] = 0x00;
		packet[1] = 0x00;
		packet[2] = 0x00;
		packet[3] = 0x03; // Domain name addressing
		packet[4] = nameLen;
		for(let i = 0; i < nameLen; i++) packet[5 + i] = targetAddr.charCodeAt(i);
		packet[5 + nameLen] = (port & 0xFF00) >> 8;
		packet[5 + nameLen + 1] = port & 0xFF;
		packet.set(fullPayload, 5 + nameLen + 2);

		if(this.socket1 && this.socket1.readyState === WebSocket.OPEN && (this.socket1 as any).fresh >= 3)
		{
			this.socket1.send(packet);
		} else if(this.socket2 && this.socket2.readyState === WebSocket.OPEN && (this.socket2 as any).fresh >= 3)
		{
			this.socket2.send(packet);
		} else
		{
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
}

widgetSelf.WebSocketMonitor = WebSocketMonitor;
widgetSelf.WebSocketMonitor.initQ3Socks5Networking();
