import { Widget } from "@lumino/widgets";
import type { ISocketMessage, WebSocketMonitor } from "./websocket";
import type { ServerEntry } from "./widget";
import { ISignal, Signal } from '@lumino/signaling';
import { Message } from "@lumino/messaging";
import type { LuminoLayoutWindow } from "../bundle/lumino.d";

export const STALE_TIMEOUT = 30000;
export const STALE_INTERVAL = 30000;
export const MAP_TIMEOUT = 60000 * 3;

const widgetSelf: LuminoLayoutWindow & {
	WebSocketMonitor: typeof WebSocketMonitor;
	MasterListWidget: typeof MasterListWidget;
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
	private serverItemHeight: number = 44; // Default fallback height in pixels
	private hasMeasuredItemHeight: boolean = false;
	private bufferItemCount: number = 5;

	private serverListEl!: HTMLUListElement;
	private favoriteListEl!: HTMLUListElement;
	public masters: ServerEntry[] = [
		{
			id: 'mas_' + Date.now() + '_' + widgetSelf.nextTemp?.(),
			name: 'Localhost',
			address: '127.0.0.1',
			mod: 'baseq3',
			players: 0,
			maxPlayers: 16,
			ping: 0,
			hasBots: false,
			isFavorite: true,
			status: 'pinging',
			when: new Date
		},
		{
			id: 'mas_' + Date.now() + '_' + widgetSelf.nextTemp?.(),
			name: 'Origin',
			address: window.location.hostname,
			mod: 'baseq3',
			players: 0,
			maxPlayers: 16,
			ping: 0,
			hasBots: false,
			isFavorite: true,
			status: 'pinging',
			when: new Date
		},
		// {
		// 	id: 'mas_' + Date.now() + '_' + widgetSelf.nextTemp?.(),
		// 	name: 'Quake 3 Original Public',
		// 	address: 'master.quake3arena.com',
		// 	mod: 'baseq3',
		// 	players: 0,
		// 	maxPlayers: 16,
		// 	ping: 0,
		// 	hasBots: false,
		// 	isFavorite: true,
		// 	status: 'pinging',
		// 	when: new Date
		// }
	];
	private servers: ServerEntry[] = [];
	public favorites: ServerEntry[] = [];
	private activeServer: ServerEntry | null = null;
	private modFilter: string = 'all';
	private hideBots: boolean = false;
	private subResponse: (_: any, args: ISocketMessage) => void = (_, args) => this.handleIncomingQ3Packet(args.address, args.port, args.data);

	private _serverSelected: Signal<Widget, IServerSelectedArgs> = new Signal<Widget, IServerSelectedArgs>(this);

	private static _instance: MasterListWidget;
	private staleInterval?: ReturnType<typeof setInterval>;
	private cachedFilteredServers: ServerEntry[] = [];
	private cachedFilteredFavorites: ServerEntry[] = [];

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

	public static getInstance()
	{
		if(!this._instance)
		{
			this._instance = new MasterListWidget();
		}
		return this._instance;
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
		this.staleInterval = setInterval(() => this.markStale(), STALE_INTERVAL);
	}


	private markStale()
	{
		for(const server of this.masters.concat(this.servers))
		{
			if(server.when.getTime() < Date.now() - STALE_TIMEOUT
				&& server.status !== 'online')
			{
				server.status = 'offline';
				server.when = new Date;
			}

			if(server.when.getTime() < Date.now() - MAP_TIMEOUT)
			{
				this.pingServer(server);
			}
		}
		this.renderServerLists();
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
		if(this.staleInterval)
		{
			clearInterval(this.staleInterval);
		}
		widgetSelf.WebSocketMonitor.serverResponse.disconnect(this.subResponse);
		super.onBeforeDetach(msg);
	}

	/* ------------------------------------------------------------------ */
	/* 4. Quake 3 Master Server Queries & Packet Parsing                  */
	/* ------------------------------------------------------------------ */
	public refreshMasterServerList(): void
	{
		for(const master of this.masters)
		{
			const parts = master.address.split(':');
			const host = parts[0];
			const port = parseInt(parts[1] || '27950', 10);

			master.status = 'pinging';
			master.when = new Date;
			// Query official dpmaster / Quake 3 master server for full list
			widgetSelf.WebSocketMonitor.sendQ3UDPMessage(host, port, 'getservers 68 full empty');
		}
		this.renderServerLists();
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

		this.serverListEl.addEventListener('scroll', () => this.onVirtualScroll(this.serverListEl, false));
		this.favoriteListEl.addEventListener('scroll', () => this.onVirtualScroll(this.favoriteListEl, true));

	}


	/**
	 * Custom Comparator for Server Ordering
	 */
	private sortServers(a: ServerEntry, b: ServerEntry): number
	{
		const aIsMaster = a.id?.startsWith('mas_') ? 1 : 0;
		const bIsMaster = b.id?.startsWith('mas_') ? 1 : 0;

		// 1. Master Servers Priority (`mas_` IDs float to top)
		if(aIsMaster !== bIsMaster)
		{
			return bIsMaster - aIsMaster;
		}

		// 2. Status Rank (online/offline higher than 'pinging')
		const aIsPinging = a.status === 'pinging' ? 1 : a.status === 'offline' ? 2 : 0;
		const bIsPinging = b.status === 'pinging' ? 1 : b.status === 'offline' ? 2 : 0;
		if(aIsPinging !== bIsPinging)
		{
			return aIsPinging - bIsPinging; // 0 (resolved) comes before 1 (pinging)
		}

		// 3. Alphanumerical Natural Sort by Name (fallback to Address)
		const nameA = a.name || a.address || '';
		const nameB = b.name || b.address || '';

		return nameA.localeCompare(nameB, undefined, {
			numeric: true,
			sensitivity: 'base'
		});
	}


	private filterServers(s: ServerEntry)
	{
		if(this.modFilter !== 'all' && s.mod !== this.modFilter) return false;
		if(this.hideBots && s.hasBots) return false;
		return true;
	}

	/* ------------------------------------------------------------------ */
	/* 2. Server List Management & Rendering                             */
	/* ------------------------------------------------------------------ */
	// private renderServerLists(): void
	// {
	// 	this.serverListEl.innerHTML = '';
	// 	this.favoriteListEl.innerHTML = '';

	// 	// Render Master & Regular Servers (Filtered + Sorted)
	// 	this.servers
	// 		.concat(this.masters)
	// 		.filter(this.filterServers)
	// 		.sort(this.sortServers)
	// 		.forEach(server =>
	// 		{
	// 			this.serverListEl.appendChild(this.createServerItemNode(server, false));
	// 		});

	// 	// Render Favorites (Filtered + Sorted)
	// 	this.favorites
	// 		.filter(this.filterServers)
	// 		.sort(this.sortServers)
	// 		.forEach(server =>
	// 		{
	// 			this.favoriteListEl.appendChild(this.createServerItemNode(server, true));
	// 		});
	// }

	private getFilteredAndSortedServers(query: ServerEntry[])
	{
		return query
			.filter((s) => this.filterServers(s))
			.sort((a, b) => this.sortServers(a, b));
	}

	private renderServerLists(): void
	{
		// Cache filtered & sorted lists
		this.cachedFilteredServers = this.getFilteredAndSortedServers(this.servers.concat(this.masters));
		this.cachedFilteredFavorites = this.getFilteredAndSortedServers(this.favorites);

		// Virtual render both containers
		this.renderVirtualViewport(this.serverListEl, this.cachedFilteredServers, false);
		this.renderVirtualViewport(this.favoriteListEl, this.cachedFilteredFavorites, true);
	}

	private onVirtualScroll(container: HTMLUListElement, isFavorite: boolean): void
	{
		const list = isFavorite ? this.cachedFilteredFavorites : this.cachedFilteredServers;
		this.renderVirtualViewport(container, list, isFavorite);
	}



	private renderVirtualViewport(container: HTMLUListElement, list: ServerEntry[], isFavorite: boolean): void
	{
		// 0. Short-circuit if container is not visible in DOM
		if(!container.offsetParent && container.clientHeight === 0)
		{
			return;
		}

		const totalItems = list.length;

		if(totalItems === 0)
		{
			const cacheKey = '0-0-0';
			if(container.dataset.lastRenderState !== cacheKey)
			{
				container.innerHTML = '<li class="sc-empty-notice" style="padding: 12px; color: #666; font-size: 11px;">No servers found</li>';
				container.dataset.lastRenderState = cacheKey;
			}
			return;
		}

		// 1. Measure first item height if not yet captured
		if(!this.hasMeasuredItemHeight && container.firstElementChild?.nextElementSibling)
		{
			const measured = container.firstElementChild.nextElementSibling.getBoundingClientRect().height;
			if(measured > 0)
			{
				this.serverItemHeight = measured;
				this.hasMeasuredItemHeight = true;
			}
		}

		// 2. Calculate Visible Window
		const scrollTop = container.scrollTop;
		const clientHeight = container.clientHeight || 250;

		let startIndex = Math.floor(scrollTop / this.serverItemHeight) - this.bufferItemCount;
		let endIndex = Math.ceil((scrollTop + clientHeight) / this.serverItemHeight) + this.bufferItemCount;

		startIndex = Math.max(0, startIndex);
		endIndex = Math.min(totalItems, endIndex);

		// 3. Short-circuit if visible window index bounds haven't changed
		const visibleSlice = list.slice(startIndex, endIndex);
		const renderStateKey = `${startIndex}-${endIndex}-${totalItems}-${visibleSlice.map(s => s.id + s.when).join('-')}`;
		if(container.dataset.lastRenderState === renderStateKey)
		{
			return;
		}
		container.dataset.lastRenderState = renderStateKey;

		const paddingTop = startIndex * this.serverItemHeight;
		const paddingBottom = (totalItems - endIndex) * this.serverItemHeight;

		// 4. Targeted DOM Reconciliation
		let topSpacer = container.querySelector('.sc-spacer-top') as HTMLLIElement;
		let bottomSpacer = container.querySelector('.sc-spacer-bottom') as HTMLLIElement;

		// Remove empty notice if present
		const notice = container.querySelector('.sc-empty-notice');
		if(notice) notice.remove();

		// Ensure Top Spacer
		if(!topSpacer)
		{
			topSpacer = document.createElement('li');
			topSpacer.className = 'sc-virtual-spacer sc-spacer-top';
			topSpacer.style.pointerEvents = 'none';
			container.prepend(topSpacer);
		}
		topSpacer.style.height = `${paddingTop}px`;
		topSpacer.style.display = paddingTop > 0 ? 'block' : 'none';

		// Ensure Bottom Spacer
		if(!bottomSpacer)
		{
			bottomSpacer = document.createElement('li');
			bottomSpacer.className = 'sc-virtual-spacer sc-spacer-bottom';
			bottomSpacer.style.pointerEvents = 'none';
			container.appendChild(bottomSpacer);
		}
		bottomSpacer.style.height = `${paddingBottom}px`;
		bottomSpacer.style.display = paddingBottom > 0 ? 'block' : 'none';

		// Build map of currently rendered item nodes
		const prefix = isFavorite ? 'fav-item-' : 'srv-item-';
		const existingNodes = new Map<string, HTMLLIElement>();

		container.querySelectorAll<HTMLLIElement>(`li[id^="${prefix}"]`).forEach(node =>
		{
			existingNodes.set(node.id, node);
		});

		// Reconcile nodes in the active slice
		const sliceIds = new Set<string>();

		visibleSlice.forEach(server =>
		{
			const id = `${prefix}${server.id}`;
			sliceIds.add(id);

			let node = existingNodes.get(id);
			if(!node)
			{
				// New node entering viewport
				node = this.createServerItemNode(server, isFavorite);
				container.insertBefore(node, bottomSpacer);
			} else
			{
				// Re-order node before bottom spacer to preserve DOM order
				this.createServerItemNode(server, isFavorite);
				container.insertBefore(node, bottomSpacer);
			}
		});

		// Clean up nodes that scrolled out of view
		existingNodes.forEach((node, id) =>
		{
			if(!sliceIds.has(id))
			{
				node.remove();
			}
		});
	}


	private createServerItemNode(server: ServerEntry, isFavList: boolean): HTMLLIElement
	{
		const prefix = isFavList ? 'fav-item-' : 'srv-item-';
		const nodeId = `${prefix}${server.id}`;

		// 1. Try to find an existing DOM node to merge data into
		let li = document.getElementById(nodeId) as HTMLLIElement | null;

		const statusClass = server.status === 'online' ? 'sc-status-online' :
			server.status === 'offline' ? 'sc-status-offline' : 'sc-status-pinging';

		const isActive = this.activeServer?.id === server.id;

		// 2. If node already exists, update properties in-place (in-place merge)
		if(li)
		{
			// Toggle active state
			li.classList.toggle('active', isActive);

			// Update status indicator class
			const statusNode = li.querySelector('.sc-status-indicator');
			if(statusNode)
			{
				statusNode.className = `sc-status-indicator ${statusClass}`;
			}

			// Update server name text node
			const nameNode = li.querySelector('.sc-server-name');
			if(nameNode)
			{
				// Preserve the status indicator span while updating server name
				const indicatorSpan = nameNode.querySelector('.sc-status-indicator');
				nameNode.textContent = server.name;
				if(indicatorSpan)
				{
					nameNode.prepend(indicatorSpan);
				}
			}

			// Update metadata string
			const metaNode = li.querySelector('.sc-server-meta');
			if(metaNode)
			{
				metaNode.textContent = `${server.address} | ${server.mod} | ${server.players}/${server.maxPlayers} (${server.ping}ms)`;
			}

			return li;
		}

		// 3. Otherwise, construct a brand new node if it doesn't exist yet
		li = document.createElement('li');
		li.id = nodeId;
		li.className = `sc-server-item ${isActive ? 'active' : ''}`;

		li.innerHTML = `
            <button class="sc-btn sc-favorite-btn"><i class='bx bx-star'></i></button>
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
			const target = e.target as HTMLElement;

			if(target.closest('.sc-favorite-btn'))
			{
				this.addFavoriteByAddress(server.address);
				this.renderServerLists();
				return;
			} else if(target.closest('.sc-remove-btn'))
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
			id: 'fav_' + Date.now() + '_' + widgetSelf.nextTemp?.(),
			name: address,
			address: address,
			mod: 'baseq3',
			players: 0,
			maxPlayers: 16,
			ping: 0,
			hasBots: false,
			isFavorite: true,
			status: 'pinging',
			when: new Date
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
					status: 'pinging',
					when: new Date
				});
				i += 7;
			} else
			{
				i++;
			}
		}

		this.servers = Array.from(
			new Map([...this.servers, ...discovered].map(server => [server.address, server])).values()
		);

		this.renderServerLists();

		// Trigger asynchronous getstatus pings to populate details
		discovered.forEach(s => this.pingServer(s));
	}


	private parseStatusResponse(fromAddr: string, remotePort: number, rawText: string): void
	{
		// 1. Sanitize Out-of-Band Header (\xFF\xFF\xFF\xFFstatusResponse\n)
		const cleanText = rawText.replace(/^[\s\S]*?statusResponse\s*[\r\n]*/i, '').trim();
		const lines = cleanText.split(/\r?\n/);
		if(lines.length === 0 || !lines[0]) return;

		// 2. Parse Cvar Key/Value Pairs
		// Quake 3 info strings start with a backslash: \sv_hostname\MyServer\mapname\q3dm17...
		const rawCvars = lines[0].startsWith('\\') ? lines[0].substring(1) : lines[0];
		const infoTokens = rawCvars.split('\\');
		const kvMap: Record<string, string> = {};

		for(let i = 0; i < infoTokens.length - 1; i += 2)
		{
			kvMap[infoTokens[i].toLowerCase()] = infoTokens[i + 1];
		}

		// 3. Extract Server Metadata & Strip Color Codes (^0-^9, ^a-^z)
		const rawHostname = kvMap['sv_hostname'] || kvMap['hostname'] || fromAddr;
		const serverName = rawHostname.replace(/\^./g, '').trim();
		const modName = kvMap['gamename'] || kvMap['game'] || 'baseq3';
		const maxPlayers = parseInt(kvMap['sv_maxclients'] || kvMap['maxclients'] || '16', 10);

		// 4. Parse Active Player Roster & Bot Detection
		// Player lines format: <score> <ping> "<name>"
		let playerCount = 0;
		let hasBots = false;
		let calculatedPingSum = 0;
		let validPingCount = 0;

		for(let i = 1; i < lines.length; i++)
		{
			const line = lines[i].trim();
			if(!line) continue;

			playerCount++;
			const parts = line.split(/\s+/);
			if(parts.length >= 2)
			{
				const ping = parseInt(parts[1], 10);

				// Ping of 0 or bot tags indicate AI clients in Q3 engines
				if(ping === 0 || line.toLowerCase().includes('bot'))
				{
					hasBots = true;
				} else if(!isNaN(ping) && ping > 0)
				{
					calculatedPingSum += ping;
					validPingCount++;
				}
			}
		}

		// Average player ping or estimated latency fallback
		const averagePing = validPingCount > 0
			? Math.round(calculatedPingSum / validPingCount)
			: 20;

		// 5. Update Target Server Entries
		const targetAddress = `${fromAddr}:${remotePort}`;
		const updateEntry = (s: ServerEntry) =>
		{
			s.name = serverName;
			s.mod = modName;
			s.players = Math.max(0, playerCount);
			s.maxPlayers = isNaN(maxPlayers) ? 16 : maxPlayers;
			s.hasBots = hasBots;
			s.status = 'online';
			s.ping = averagePing;
			s.rawStatus = rawText;
			s.when = new Date();

			// Perform Targeted DOM update on Virtual Scroller
			const isFav = this.favorites.some(f => f.id === s.id);
			//this.updateServerEntry(s, isFav);
		};

		// Match both by full address (IP:Port) or IP substring fallback
		this.servers.filter(s => s.address === targetAddress || s.address.includes(fromAddr)).forEach(updateEntry);
		this.favorites.filter(f => f.address === targetAddress || f.address.includes(fromAddr)).forEach(updateEntry);
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

	public pingServer(server: ServerEntry): void
	{
		const parts = server.address.split(':');
		const host = parts[0];
		const port = parseInt(parts[1] || '27960', 10);
		if(server.status !== 'online')
		{
			server.status = 'pinging';
		}
		server.when = new Date;
		widgetSelf.WebSocketMonitor.sendQ3UDPMessage(host, port, 'getstatus');
	}

	private handleIncomingQ3Packet(fromAddr: string, port: number = 27960, data: Uint8Array): void
	{
		const text = new TextDecoder().decode(data);

		// Handle Master Server Response: getserversResponse
		if(text.includes('getserversResponse'))
		{
			const master = this.masters.find(m => m.address.replaceAll('\0', '') === fromAddr
				|| m.address.replaceAll('\0', '') === fromAddr + ':' + port
			);
			if(master)
			{
				master.status = 'online';
				master.when = new Date;
			}
			this.parseMasterServerResponse(data);
			return;
		}

		// Handle Individual Server Response: statusResponse
		if(text.includes('statusResponse'))
		{
			this.parseStatusResponse(fromAddr, port, text);
			return;
		}
	}
}

widgetSelf.MasterListWidget = MasterListWidget;
