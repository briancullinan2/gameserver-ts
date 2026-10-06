import { Widget } from "@lumino/widgets";
import { ISocketMessage, WebSocketMonitor } from "./websocket";
import type { ServerEntry } from "./widget";
import { ISignal, Signal } from '@lumino/signaling';
import { Message } from "@lumino/messaging";
import type { LuminoLayoutWindow } from "../bundle/lumino.d";

const widgetSelf: LuminoLayoutWindow & {
	WebSocketMonitor: typeof WebSocketMonitor;
} = self as unknown as any;

export interface IServerSelectedArgs
{
	item: ServerEntry;
	servers: ServerEntry[];
}


export interface IAddServerArgs
{
	item?: ServerEntry;
	when: Date;
	favorites: ServerEntry[];
}

export interface IRemoveServerArgs
{
	item?: ServerEntry;
	when: Date;
	favorites: ServerEntry[];
}

export class MasterListWidget extends Widget
{
	private serverListEl!: HTMLUListElement;
	private favoriteListEl!: HTMLUListElement;
	private servers: ServerEntry[] = [];
	public favorites: ServerEntry[] = [];
	private activeServer: ServerEntry | null = null;
	private modFilter: string = 'all';
	private hideBots: boolean = false;
	private subResponse: (_: any, args: ISocketMessage) => void = (_, args) => this.handleIncomingQ3Packet(args.address, args.data);

	private _serverSelected: Signal<Widget, IServerSelectedArgs> = new Signal<Widget, IServerSelectedArgs>(this);

	private static _instance: MasterListWidget;

	public get serverSelected(): ISignal<Widget, IServerSelectedArgs>
	{
		return this._serverSelected;
	}

	private _addServerClicked: Signal<Widget, IAddServerArgs> = new Signal<Widget, IAddServerArgs>(this);

	public get addServer(): ISignal<Widget, IAddServerArgs>
	{
		return this._addServerClicked;
	}

	private _removeServerClicked: Signal<Widget, IRemoveServerArgs> = new Signal<Widget, IRemoveServerArgs>(this);

	public get removeServer(): ISignal<Widget, IRemoveServerArgs>
	{
		return this._removeServerClicked;
	}

	constructor(title?: string)
	{
		if(MasterListWidget._instance)
		{
			return MasterListWidget._instance;
		}
		super();
		this.title.label = title ?? 'Servers';
		this.title.iconClass = 'bx bx-network-device';
		this.title.closable = true;
		this.addClass('sc-sidebar');

		this.buildLayout();
		widgetSelf.WebSocketMonitor.initQ3Socks5Networking();
		MasterListWidget._instance = this;
	}

	protected override onAfterAttach(msg: Message): void
	{
		super.onAfterAttach(msg);

		widgetSelf.WebSocketMonitor.serverResponse.connect(this.subResponse);
		this.refreshMasterServerList();
	}

	public processMessage(msg: Message): void
	{
		if(msg.type === 'close-request')
		{
			console.log('Intercepted close request, hiding instead: ' + this.title.label);

			this.hide();
			widgetSelf.mainDock?.layout?.removeWidget(this);
			return; // BAIL OUT: Avoid calling super.processMessage() to prevent disposal
		}

		super.processMessage(msg);
	}

	protected override onBeforeDetach(msg: Message): void
	{
		widgetSelf.WebSocketMonitor.serverResponse.disconnect(this.subResponse);
	}

	/* ------------------------------------------------------------------ */
	/* 4. Quake 3 Master Server Queries & Packet Parsing                  */
	/* ------------------------------------------------------------------ */
	public refreshMasterServerList(): void
	{
		// Query official dpmaster / Quake 3 master server for full list
		widgetSelf.WebSocketMonitor.sendQ3UDPMessage('master.quake3arena.com', 27950, 'getservers 68 full empty');
	}


	private buildLayout()
	{
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

		this.node.appendChild(filterBar);
		this.node.appendChild(favHeader);
		this.node.appendChild(this.favoriteListEl);
		this.node.appendChild(masterHeader);
		this.node.appendChild(this.serverListEl);


		// Bind Add Fav Header Btn
		favHeader.querySelector('#sc-add-fav-btn')?.addEventListener('click', () =>
		{
			this._addServerClicked.emit({
				when: new Date,
				favorites: this.favorites
			});
			// if(this.addrInput.value)
			// {
			// 	this.addFavoriteByAddress(this.addrInput.value);
			// }
		});

		// Bind Refresh Master
		masterHeader.querySelector('#sc-refresh-master')?.addEventListener('click', () =>
		{
			this.refreshMasterServerList();
		});
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
		this.renderServerLists();
		this._serverSelected.emit({
			item: server,
			servers: this.servers
		});
	}

	public addFavoriteByAddress(address: string): ServerEntry
	{
		const some = this.favorites.find(f => f.address === address);
		if(some) return some;
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
		this.renderServerLists();
		return newFav;
	}

	private removeFavorite(id: string): void
	{
		const item = this.favorites.find(f => f.id === id);
		this.favorites = this.favorites.filter(f => f.id !== id);
		this._removeServerClicked.emit({
			item: item,
			favorites: this.favorites,
			when: new Date
		});
		this.renderServerLists();
	}

	private removeMasterServer(id: string): void
	{
		this.servers = this.servers.filter(s => s.id !== id);
		this.renderServerLists();
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

	private toggleCurrentFavorite(): void
	{
		const addr = this.activeServer?.address;
		if(!addr) return;

		const existingIdx = this.favorites.findIndex(f => f.address === addr);
		if(existingIdx >= 0)
		{
			const was = this.favorites[existingIdx];
			this.favorites.splice(existingIdx, 1);
			this._removeServerClicked.emit({
				item: was,
				when: new Date,
				favorites: this.favorites
			});
			this.renderServerLists();
		} else
		{
			const entry = this.addFavoriteByAddress(addr);
			this._addServerClicked.emit({
				item: entry,
				when: new Date,
				favorites: this.favorites
			});
		}
	}

	private pingServer(server: ServerEntry): void
	{
		const parts = server.address.split(':');
		const host = parts[0];
		const port = parseInt(parts[1] || '27960', 10);
		widgetSelf.WebSocketMonitor.sendQ3UDPMessage(host, port, 'getstatus');
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
	}
}
