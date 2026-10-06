import type { LuminoLayoutWindow } from "../bundle/lumino.d";
import type { Q3NetworkConfig } from "./widget";
import { ISignal, Signal } from '@lumino/signaling';


export interface ISocketMessage
{
	address: string,
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


	public static get serverResponse(): ISignal<any, ISocketMessage>
	{
		return this._serverResponse;
	}

	/* ------------------------------------------------------------------ */
	/* 3. Quake 3 WebSocket SOCKS5 Protocol Networking                    */
	/* ------------------------------------------------------------------ */
	public static initQ3Socks5Networking(config?: Q3NetworkConfig): void
	{
		if(config)
		{
			this.netConfig = config;
		}
		const fullAddress = `${this.netConfig.socksPort === 443 ? 'wss' : 'ws'}://${this.netConfig.socksServer}:${this.netConfig.socksPort}`;

		try
		{
			if(!this.socket1)
			{
				this.socket1 = new WebSocket(fullAddress);
				this.socket1.binaryType = 'arraybuffer';
				this.socket1.addEventListener('open', (e) => this.onSocketOpen(e));
				this.socket1.addEventListener('message', (e) => this.onSocketMessage(e));
				this.socket1.addEventListener('error', (e) => this.onSocketError(e));
			}

			if(!this.socket2)
			{
				this.socket2 = new WebSocket(fullAddress);
				this.socket2.binaryType = 'arraybuffer';
				this.socket2.addEventListener('open', (e) => this.onSocketOpen(e));
				this.socket2.addEventListener('message', (e) => this.onSocketMessage(e));
				this.socket2.addEventListener('error', (e) => this.onSocketError(e));
			}

			if(!this.heartbeatTimer)
			{
				this.heartbeatTimer = setInterval(() => this.sendHeartbeats(), 9000);
			}

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
			console.error('Failed to initialize SOCKS5 WebSockets:', err);
		}
	}


	private static onSocketError(evt: Event)
	{
		this.reconnect = true;
		if(evt.target == this.socket1)
		{
			this.socket1 = null;
		}
		if(evt.target == this.socket2)
		{
			this.socket2 = null;
		}
	}

	private static onSocketOpen(evt: Event): void
	{
		const ws = evt.target as any;
		ws.fresh = 1;
		// Step 1: SOCKS5 Handshake (No Auth)
		ws.send(Uint8Array.from([0x05, 0x01, 0x00]));
		if(!this.heartbeatTimer)
		{
			this.heartbeatTimer = setInterval(() =>
			{
				this.sendHeartbeats();
			}, 9000);
		}
		if(!this.reconnect) return;
		this.sendEmscriptenPortMessage(evt.target as WebSocket, this.netConfig.netPort);
	}

	private static onSocketMessage(evt: MessageEvent): void
	{
		const ws = evt.target as any;
		if(typeof evt.data === 'string') return;
		const message = new Uint8Array(evt.data);

		switch(ws.fresh)
		{
			case 1:
				if(message.length === 2 && message[1] === 0x00)
				{
					// Step 2: UDP Associate Request
					ws.send(Uint8Array.from([
						0x05, 0x03, 0x00, 0x01,
						0x00, 0x00, 0x00, 0x00,
						(this.netConfig.netPort & 0xFF00) >> 8, (this.netConfig.netPort & 0xFF)
					]));
					ws.fresh = 2;
				}
				break;

			case 2:
				// Step 3: Emscripten Bridge Port Handshake
				this.sendEmscriptenPortMessage(ws, this.netConfig.netPort);
				widgetSelf.statusBar?.updateStatusItem('ws-state', '[WS] Active');
				const stateNode = this._websocketState?.querySelector('i');
				if(stateNode)
				{
					stateNode.className = 'bx bx-circle-marked';
				}
				ws.fresh = 3;
				break;

			case 3:
				if(message.length === 10)
				{
					ws.fresh = 4;
					break;
				}
			case 4:
			case 5:
				if(message.length <= 10) return;

				// Decode incoming Q3 SOCKS5 packet
				let addrStr = '';
				let msgData: Uint8Array;

				if(message[3] === 1)
				{ // IPv4
					addrStr = `${message[4]}.${message[5]}.${message[6]}.${message[7]}`;
					msgData = message.slice(10);
				} else if(message[3] === 3)
				{ // Domain
					const domainLen = message[4];
					addrStr = Array.from(message.slice(5, 5 + domainLen)).map(c => String.fromCharCode(c)).join('');
					msgData = message.slice(5 + domainLen + 2);
				} else
				{
					return;
				}

				this._serverResponse.emit({
					address: addrStr,
					data: msgData
				});
				// this.handleIncomingQ3Packet(addrStr, msgData);
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
		}
	}

	private static sendHeartbeats(): void
	{
		[this.socket1, this.socket2].forEach(sock =>
		{
			if(sock && sock.readyState === WebSocket.OPEN && (sock as any).fresh >= 3)
			{
				sock.send(Uint8Array.from([0x05, 0x01, 0x00, 0x00]));
			}
		});
	}

	public static shutdownNetworking(): void
	{
		if(this.heartbeatTimer) clearInterval(this.heartbeatTimer);
		if(this.socket1) this.socket1.close();
		if(this.socket2) this.socket2.close();
	}


	private static sendEmscriptenPortMessage(socket: WebSocket, port: number): void
	{
		socket.send(Uint8Array.from([
			0xFF, 0xFF, 0xFF, 0xFF,
			'p'.charCodeAt(0), 'o'.charCodeAt(0), 'r'.charCodeAt(0), 't'.charCodeAt(0),
			(port & 0xFF00) >> 8, (port & 0xFF)
		]));
	}
}

widgetSelf.WebSocketMonitor = WebSocketMonitor;
widgetSelf.WebSocketMonitor.initQ3Socks5Networking();
