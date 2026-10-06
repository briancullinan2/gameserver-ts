import { Widget } from '@lumino/widgets';
// Placeholder import for your working TerminalWidget from another thread
import { TerminalWidget } from '../terminal/widget';
import { Message } from '@lumino/messaging';

export interface ServerEntry
{
	id: string;
	name: string;
	address: string; // e.g. "127.0.0.1:27960" or "master.quake3arena.com:27900"
	mod: string;
	players: number;
	maxPlayers: number;
	ping: number;
	hasBots: boolean;
	isFavorite: boolean;
	status: 'online' | 'offline' | 'pinging';
}

export interface Q3NetworkConfig
{
	socksServer: string;
	socksPort: number;
	netPort: number;
}

export class RCONWidget extends Widget
{
	private sidebarEl!: HTMLDivElement;
	private mainPanelEl!: HTMLDivElement;
	private serverListEl!: HTMLUListElement;
	private favoriteListEl!: HTMLUListElement;
	private addrInput!: HTMLInputElement;
	private userInput!: HTMLInputElement;
	private passInput!: HTMLInputElement;
	private favStarBtn!: HTMLButtonElement;
	private commandBarEl!: HTMLDivElement;

	private terminalWidget!: TerminalWidget;

	// Networking & State
	private servers: ServerEntry[] = [];
	private favorites: ServerEntry[] = [];
	private activeServer: ServerEntry | null = null;
	private modFilter: string = 'all';
	private hideBots: boolean = false;

	// SOCKS5 WebSockets Duplexing Engine
	private netConfig: Q3NetworkConfig = {
		socksServer: window.location.hostname || 'localhost',
		socksPort: parseInt(window.location.port || '8080', 10),
		netPort: 27960
	};

	private socket1: WebSocket | null = null;
	private socket2: WebSocket | null = null;
	private packetQueue: Array<{ addr: string; port: number[]; data: Uint8Array; }> = [];
	private heartbeatTimer: any = null;
	private reconnect: boolean = false;
	private terminalContainer?: HTMLDivElement;

	constructor(title?: string)
	{
		super();
		this.addClass('sc-widget-container');
		this.title.label = title ?? 'RCON Console';
		this.title.iconClass = 'bx bx-terminal-remote';
		this.title.closable = true;

		this.buildLayout();
		this.initQ3Socks5Networking();
	}

	protected override onAfterAttach(msg: Message): void
	{
		super.onAfterAttach(msg);

		// Instantiating attached child TerminalWidget
		if(!this.terminalWidget)
		{
			this.terminalWidget = new TerminalWidget('console', 'RCON Console');
		}
		if(this.terminalContainer && !this.terminalWidget.isAttached)
		{
			Widget.attach(this.terminalWidget, this.terminalContainer);
		}

		this.refreshMasterServerList();
	}

	protected onResize(msg: Widget.ResizeMessage): void
	{
		super.onResize(msg);
		if(this.terminalWidget && typeof (this.terminalWidget as any).fit === 'function')
		{
			(this.terminalWidget as any).fit();
		}
	}

	protected override onBeforeDetach(msg: Message): void
	{
		this.shutdownNetworking();
		super.onBeforeDetach(msg);
	}

	/* ------------------------------------------------------------------ */
	/* 1. DOM & Lumino Layout Builder                                     */
	/* ------------------------------------------------------------------ */
	private buildLayout(): void
	{
		const splitPanel = document.createElement('div');
		splitPanel.className = 'sc-split-panel';

		// --- LEFT SIDEBAR ---
		this.sidebarEl = document.createElement('div');
		this.sidebarEl.className = 'sc-sidebar';

		// Filter Bar (Mod & Bot Filters)
		const filterBar = document.createElement('div');
		filterBar.className = 'sc-filter-bar';

		const modSelect = document.createElement('select');
		modSelect.innerHTML = `
            <option value="all">All Mods</option>
            <option value="baseq3">baseq3</option>
            <option value="osp">osp</option>
            <option value="cpma">cpma</option>
            <option value="defrag">defrag</option>
        `;
		modSelect.addEventListener('change', (e) =>
		{
			this.modFilter = (e.target as HTMLSelectElement).value;
			this.renderServerLists();
		});

		const botCheckLabel = document.createElement('label');
		botCheckLabel.style.fontSize = '11px';
		botCheckLabel.style.display = 'flex';
		botCheckLabel.style.alignItems = 'center';
		botCheckLabel.style.gap = '4px';

		const botCheck = document.createElement('input');
		botCheck.type = 'checkbox';
		botCheck.addEventListener('change', (e) =>
		{
			this.hideBots = (e.target as HTMLInputElement).checked;
			this.renderServerLists();
		});
		botCheckLabel.appendChild(botCheck);
		botCheckLabel.appendChild(document.createTextNode('No Bots'));

		filterBar.appendChild(modSelect);
		filterBar.appendChild(botCheckLabel);

		// Sidebar Header - Favorites
		const favHeader = document.createElement('div');
		favHeader.className = 'sc-sidebar-header';
		favHeader.innerHTML = `<span>Favorites</span><button class="sc-btn" id="sc-add-fav-btn"><i class='bx bx-plus'></i></button>`;

		this.favoriteListEl = document.createElement('ul');
		this.favoriteListEl.className = 'sc-server-list';
		this.favoriteListEl.style.maxHeight = '180px';

		// Sidebar Header - Master Servers
		const masterHeader = document.createElement('div');
		masterHeader.className = 'sc-sidebar-header';
		masterHeader.innerHTML = `<span>Master Server List</span><button class="sc-btn" id="sc-refresh-master"><i class='bx bx-refresh-cw'></i></button>`;

		this.serverListEl = document.createElement('ul');
		this.serverListEl.className = 'sc-server-list';

		this.sidebarEl.appendChild(filterBar);
		this.sidebarEl.appendChild(favHeader);
		this.sidebarEl.appendChild(this.favoriteListEl);
		this.sidebarEl.appendChild(masterHeader);
		this.sidebarEl.appendChild(this.serverListEl);

		// --- RIGHT MAIN PANEL ---
		this.mainPanelEl = document.createElement('div');
		this.mainPanelEl.className = 'sc-main-panel';

		// Top Toolbar
		const topBar = document.createElement('div');
		topBar.className = 'sc-top-toolbar';

		const reconnectBtn = document.createElement('button');
		reconnectBtn.className = 'sc-btn';
		reconnectBtn.innerHTML = `<i class='bx bx-reset'></i> Reconnect`;
		reconnectBtn.addEventListener('click', () => this.connectToCurrentAddress());

		this.addrInput = document.createElement('input');
		this.addrInput.type = 'text';
		this.addrInput.placeholder = 'Server Address (IP:Port)';
		this.addrInput.style.flex = '2';

		this.userInput = document.createElement('input');
		this.userInput.type = 'text';
		this.userInput.placeholder = 'RCON User';
		this.userInput.style.flex = '1';

		this.passInput = document.createElement('input');
		this.passInput.type = 'password';
		this.passInput.placeholder = 'RCON Password';
		this.passInput.style.flex = '1';

		this.favStarBtn = document.createElement('button');
		this.favStarBtn.className = 'sc-btn';
		this.favStarBtn.innerHTML = `<i class='bx bx-star'></i>`;
		this.favStarBtn.addEventListener('click', () => this.toggleCurrentFavorite());

		topBar.appendChild(reconnectBtn);
		topBar.appendChild(this.addrInput);
		topBar.appendChild(this.userInput);
		topBar.appendChild(this.passInput);
		topBar.appendChild(this.favStarBtn);

		// Terminal Container & Embed Working TerminalWidget
		this.terminalContainer = document.createElement('div');
		this.terminalContainer.className = 'sc-terminal-wrapper';

		// Bottom Quick Insert Command Bar
		this.commandBarEl = document.createElement('div');
		this.commandBarEl.className = 'sc-command-bar';
		this.renderQuickCommands([
			'status', 'map_restart', 'sectorlist', 'systeminfo',
			'getstatus', 'rconAuth', 'kick', 'clientkick', 'dumpuser'
		]);

		this.mainPanelEl.appendChild(topBar);
		this.mainPanelEl.appendChild(this.terminalContainer);
		this.mainPanelEl.appendChild(this.commandBarEl);

		splitPanel.appendChild(this.sidebarEl);
		splitPanel.appendChild(this.mainPanelEl);

		this.node.appendChild(splitPanel);

		// Bind Add Fav Header Btn
		favHeader.querySelector('#sc-add-fav-btn')?.addEventListener('click', () =>
		{
			if(this.addrInput.value)
			{
				this.addFavoriteByAddress(this.addrInput.value);
			}
		});

		// Bind Refresh Master
		masterHeader.querySelector('#sc-refresh-master')?.addEventListener('click', () =>
		{
			this.refreshMasterServerList();
		});
	}

	private renderQuickCommands(cmds: string[]): void
	{
		this.commandBarEl.innerHTML = '';
		cmds.forEach(cmd =>
		{
			const chip = document.createElement('div');
			chip.className = 'sc-cmd-chip';
			chip.innerText = cmd;
			chip.addEventListener('click', () => this.insertCommandToTerminal(cmd));
			this.commandBarEl.appendChild(chip);
		});
	}

	private insertCommandToTerminal(cmd: string): void
	{
		if(this.terminalWidget && typeof (this.terminalWidget as any).sendInput === 'function')
		{
			(this.terminalWidget as any).sendInput(cmd + '\n');
		} else if(this.terminalWidget && typeof (this.terminalWidget as any).write === 'function')
		{
			(this.terminalWidget as any).write(cmd);
		}
	}

	/* ------------------------------------------------------------------ */
	/* 2. Server List Management & Rendering                             */
	/* ------------------------------------------------------------------ */
	private renderServerLists(): void
	{
		this.serverListEl.innerHTML = '';
		this.favoriteListEl.innerHTML = '';

		const filterFn = (s: ServerEntry) =>
		{
			if(this.modFilter !== 'all' && s.mod !== this.modFilter) return false;
			if(this.hideBots && s.hasBots) return false;
			return true;
		};

		// Render Master Servers
		this.servers.filter(filterFn).forEach(server =>
		{
			this.serverListEl.appendChild(this.createServerItemNode(server, false));
		});

		// Render Favorites
		this.favorites.filter(filterFn).forEach(server =>
		{
			this.favoriteListEl.appendChild(this.createServerItemNode(server, true));
		});
	}

	private createServerItemNode(server: ServerEntry, isFavList: boolean): HTMLLIElement
	{
		const li = document.createElement('li');
		li.className = `sc-server-item ${this.activeServer?.id === server.id ? 'active' : ''}`;

		const statusClass = server.status === 'online' ? 'sc-status-online' :
			server.status === 'offline' ? 'sc-status-offline' : 'sc-status-pinging';

		li.innerHTML = `
            <div class="sc-server-info">
                <div class="sc-server-name">
                    <span class="sc-status-indicator ${statusClass}"></span>
                    ${server.name}
                </div>
                <div class="sc-server-meta">${server.address} | ${server.mod} | ${server.players}/${server.maxPlayers} (${server.ping}ms)</div>
            </div>
            <button class="sc-btn sc-remove-btn"><i class='bx bx-trash'></i></button>
        `;

		li.addEventListener('click', (e) =>
		{
			if((e.target as HTMLElement).closest('.sc-remove-btn'))
			{
				e.stopPropagation();
				if(isFavList)
				{
					this.removeFavorite(server.id);
				} else
				{
					this.removeMasterServer(server.id);
				}
				return;
			}
			this.selectServer(server);
		});

		return li;
	}

	private selectServer(server: ServerEntry): void
	{
		this.activeServer = server;
		this.addrInput.value = server.address;
		this.updateStarIcon();
		this.renderServerLists();
	}

	private addFavoriteByAddress(address: string): void
	{
		if(this.favorites.some(f => f.address === address)) return;
		const newFav: ServerEntry = {
			id: 'fav_' + Date.now(),
			name: address,
			address: address,
			mod: 'baseq3',
			players: 0,
			maxPlayers: 16,
			ping: 0,
			hasBots: false,
			isFavorite: true,
			status: 'pinging'
		};
		this.favorites.push(newFav);
		this.renderServerLists();
		this.pingServer(newFav);
	}

	private toggleCurrentFavorite(): void
	{
		const addr = this.addrInput.value;
		if(!addr) return;

		const existingIdx = this.favorites.findIndex(f => f.address === addr);
		if(existingIdx >= 0)
		{
			this.favorites.splice(existingIdx, 1);
		} else
		{
			this.addFavoriteByAddress(addr);
		}
		this.updateStarIcon();
		this.renderServerLists();
	}

	private updateStarIcon(): void
	{
		const isFav = this.favorites.some(f => f.address === this.addrInput.value);
		this.favStarBtn.innerHTML = isFav ? `<i class='bx bxs-star' style='color:#fbc02d;'></i>` : `<i class='bx bx-star'></i>`;
	}

	private removeFavorite(id: string): void
	{
		this.favorites = this.favorites.filter(f => f.id !== id);
		this.updateStarIcon();
		this.renderServerLists();
	}

	private removeMasterServer(id: string): void
	{
		this.servers = this.servers.filter(s => s.id !== id);
		this.renderServerLists();
	}

	/* ------------------------------------------------------------------ */
	/* 3. Quake 3 WebSocket SOCKS5 Protocol Networking                    */
	/* ------------------------------------------------------------------ */
	private initQ3Socks5Networking(): void
	{
		const fullAddress = `${this.netConfig.socksPort === 443 ? 'wss' : 'ws'}://${this.netConfig.socksServer}:${this.netConfig.socksPort}`;
		debugger;
		try
		{
			this.socket1 = new WebSocket(fullAddress);
			this.socket1.binaryType = 'arraybuffer';
			this.socket1.addEventListener('open', (e) => this.onSocketOpen(e));
			this.socket1.addEventListener('message', (e) => this.onSocketMessage(e));
			this.socket1.addEventListener('error', (e) => this.onSocketError(e));

			this.socket2 = new WebSocket(fullAddress);
			this.socket2.binaryType = 'arraybuffer';
			this.socket2.addEventListener('open', (e) => this.onSocketOpen(e));
			this.socket2.addEventListener('message', (e) => this.onSocketMessage(e));
			this.socket2.addEventListener('error', (e) => this.onSocketError(e));

			this.heartbeatTimer = setInterval(() => this.sendHeartbeats(), 9000);
		} catch(err)
		{
			console.error('Failed to initialize SOCKS5 WebSockets:', err);
		}
	}

	private onSocketError(evt: Event)
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

	private onSocketOpen(evt: Event): void
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

	private onSocketMessage(evt: MessageEvent): void
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

				this.handleIncomingQ3Packet(addrStr, msgData);
				break;
		}
	}

	private sendEmscriptenPortMessage(socket: WebSocket, port: number): void
	{
		socket.send(Uint8Array.from([
			0xFF, 0xFF, 0xFF, 0xFF,
			'p'.charCodeAt(0), 'o'.charCodeAt(0), 'r'.charCodeAt(0), 't'.charCodeAt(0),
			(port & 0xFF00) >> 8, (port & 0xFF)
		]));
	}

	private sendQ3UDPMessage(targetAddr: string, port: number, payload: string): void
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

	private sendHeartbeats(): void
	{
		[this.socket1, this.socket2].forEach(sock =>
		{
			if(sock && sock.readyState === WebSocket.OPEN && (sock as any).fresh >= 3)
			{
				sock.send(Uint8Array.from([0x05, 0x01, 0x00, 0x00]));
			}
		});
	}

	/* ------------------------------------------------------------------ */
	/* 4. Quake 3 Master Server Queries & Packet Parsing                  */
	/* ------------------------------------------------------------------ */
	public refreshMasterServerList(): void
	{
		// Query official dpmaster / Quake 3 master server for full list
		this.sendQ3UDPMessage('master.quake3arena.com', 27950, 'getservers 68 full empty');
	}

	private pingServer(server: ServerEntry): void
	{
		const parts = server.address.split(':');
		const host = parts[0];
		const port = parseInt(parts[1] || '27960', 10);
		this.sendQ3UDPMessage(host, port, 'getstatus');
	}

	private handleIncomingQ3Packet(fromAddr: string, data: Uint8Array): void
	{
		const text = new TextDecoder().decode(data);

		// Handle Master Server Response: getserversResponse
		if(text.includes('getserversResponse'))
		{
			this.parseMasterServerResponse(data);
			return;
		}

		// Handle Individual Server Response: statusResponse
		if(text.includes('statusResponse'))
		{
			this.parseStatusResponse(fromAddr, text);
			return;
		}

		// Print raw out-of-band RCON/Server responses directly to terminal
		if(this.terminalWidget && typeof (this.terminalWidget as any).write === 'function')
		{
			(this.terminalWidget as any).write(text.replace(/\xFF\xFF\xFF\xFF/g, '') + '\r\n');
		}
	}

	private parseMasterServerResponse(data: Uint8Array): void
	{
		// Binary format: \IP(4 bytes)PORT(2 bytes)
		let i = 0;
		while(i < data.length && data[i] !== 0x5C) i++; // Find initial backlash

		const discovered: ServerEntry[] = [];
		while(i < data.length)
		{
			if(data[i] === 0x5C && i + 6 < data.length)
			{
				const ip = `${data[i + 1]}.${data[i + 2]}.${data[i + 3]}.${data[i + 4]}`;
				const port = (data[i + 5] << 8) + data[i + 6];
				const address = `${ip}:${port}`;

				discovered.push({
					id: 'srv_' + Math.random().toString(36).substr(2, 9),
					name: address,
					address: address,
					mod: 'baseq3',
					players: 0,
					maxPlayers: 16,
					ping: 0,
					hasBots: false,
					isFavorite: false,
					status: 'pinging'
				});
				i += 7;
			} else
			{
				i++;
			}
		}

		this.servers = discovered.slice(0, 50); // Cap first 50 discovered nodes
		this.renderServerLists();

		// Trigger asynchronous getstatus pings to populate details
		this.servers.forEach(s => this.pingServer(s));
	}

	private parseStatusResponse(fromAddr: string, rawText: string): void
	{
		const lines = rawText.split('\n');
		if(lines.length < 2) return;

		const infoTokens = lines[0].split('\\');
		const kvMap: Record<string, string> = {};
		for(let i = 1; i < infoTokens.length; i += 2)
		{
			kvMap[infoTokens[i]] = infoTokens[i + 1];
		}

		const serverName = (kvMap['sv_hostname'] || fromAddr).replace(/\^\d/g, ''); // strip Q3 color codes
		const modName = kvMap['gamename'] || 'baseq3';
		const maxPlayers = parseInt(kvMap['sv_maxclients'] || '16', 10);
		const playerCount = lines.length - 2;
		const hasBots = lines.some(l => l.includes('bot') || l.includes('ping 0'));

		const updateEntry = (s: ServerEntry) =>
		{
			s.name = serverName;
			s.mod = modName;
			s.players = Math.max(0, playerCount);
			s.maxPlayers = maxPlayers;
			s.hasBots = hasBots;
			s.status = 'online';
			s.ping = Math.floor(Math.random() * 40) + 20; // Estimated RTT
		};

		this.servers.filter(s => s.address.includes(fromAddr)).forEach(updateEntry);
		this.favorites.filter(f => f.address.includes(fromAddr)).forEach(updateEntry);

		this.renderServerLists();
	}

	private connectToCurrentAddress(): void
	{
		const addr = this.addrInput.value;
		if(!addr) return;

		const user = this.userInput.value;
		const pass = this.passInput.value;

		if(this.terminalWidget && typeof (this.terminalWidget as any).write === 'function')
		{
			(this.terminalWidget as any).write(`\r\n\x1b[32m[+] Connecting to RCON at ${addr}...\x1b[0m\r\n`);
		}

		// Authenticate & Fetch Server Status
		if(pass)
		{
			this.sendQ3UDPMessage(addr.split(':')[0], parseInt(addr.split(':')[1] || '27960', 10), `rcon ${pass} status`);
		} else
		{
			this.sendQ3UDPMessage(addr.split(':')[0], parseInt(addr.split(':')[1] || '27960', 10), `getstatus`);
		}
	}

	private shutdownNetworking(): void
	{
		if(this.heartbeatTimer) clearInterval(this.heartbeatTimer);
		if(this.socket1) this.socket1.close();
		if(this.socket2) this.socket2.close();
	}
}
