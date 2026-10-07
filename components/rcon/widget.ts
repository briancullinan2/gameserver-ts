import { Widget } from '@lumino/widgets';
// Placeholder import for your working TerminalWidget from another thread
import { TerminalWidget } from '../terminal/widget';
import { Message } from '@lumino/messaging';
import type { LuminoLayoutWindow } from '../bundle/lumino.d';
import type { GlobalToolbarsWindow, LuminoMenuWindow, RepositorySettingsWindow } from '../bundle/menu.d';
import { ISocketMessage, WebSocketMonitor } from './websocket';
import { IAddServerArgs, IRemoveServerArgs, IServerSelectedArgs, MasterListWidget } from './widget-master';
import type { SettingConfig } from '../bundle/settings';

const widgetSelf: {
	WebSocketMonitor: typeof WebSocketMonitor;
} & GlobalToolbarsWindow & LuminoLayoutWindow & LuminoMenuWindow & RepositorySettingsWindow = self as unknown as any;

export interface ServerEntry
{
	id: string;
	name: string;
	address: string; // e.g. "127.0.0.1:27960" or "master.quake3arena.com:27900"
	mod: string;
	players: number;
	maxPlayers: number;
	when: Date;
	ping: number;
	hasBots: boolean;
	isFavorite: boolean;
	status: 'online' | 'offline' | 'pinging';
	rawStatus?: string;
}

export interface Q3NetworkConfig
{
	socksServer: string;
	socksPort: number;
	netPort: number;
}

export class RCONWidget extends Widget
{
	private addrInput!: HTMLInputElement;
	private userInput!: HTMLInputElement;
	private passInput!: HTMLInputElement;
	private favStarBtn!: HTMLButtonElement;
	private commandBarEl!: HTMLDivElement;

	private terminalWidget!: TerminalWidget;

	// Networking & State
	private terminalContainer?: HTMLDivElement;
	private mastersSidebar?: MasterListWidget;
	private subSelect: (_: any, args: IServerSelectedArgs) => void = (_, args) => this.selectServer(args.item);
	private subAdd: (_: any, args: IAddServerArgs) => void = (_, args) => this.addServer(args.item);
	private subRemove: (_: any, args: IRemoveServerArgs) => void = (_, args) => this.removeServer(args.item);
	private subResponse: (_: any, args: ISocketMessage) => void = (_, args) => this.handleIncomingQ3Packet(args.address, args.data);

	constructor(title?: string)
	{
		super();
		this.addClass('sc-widget-container');
		this.title.label = title ?? 'RCON Console';
		this.title.iconClass = 'bx bx-terminal-remote';
		this.title.closable = true;

		this.buildLayout();
		widgetSelf.WebSocketMonitor.initQ3Socks5Networking();
	}

	protected override onAfterShow(msg: Message): void
	{
		super.onAfterShow(msg);
		this.openMasters();
	}


	private openMasters()
	{
		const that = this;
		if(!this.mastersSidebar)
		{
			this.mastersSidebar = new MasterListWidget();
			this.mastersSidebar.serverSelected.connect(this.subSelect);
			this.mastersSidebar.removeServer.connect(this.subRemove);
			this.mastersSidebar.addServer.connect(this.subAdd);
		}
		setTimeout(() =>
		{
			if(this.mastersSidebar && !this.mastersSidebar.isAttached)
			{
				if(widgetSelf.mainDock && widgetSelf.LayoutAdjuster && that.mastersSidebar)
				{
					if(!this.mastersSidebar?.isAttached)
					{
						widgetSelf.LayoutAdjuster?.addOptimalWidgetLayout(widgetSelf.mainDock, that.mastersSidebar, {
							type: 'outline',
							projectId: that.mastersSidebar?.constructor.name
						});
					}
				}
			}
		}, 300);
	}


	private addServer(server?: ServerEntry)
	{
		this.updateStarIcon();
	}


	private removeServer(server?: ServerEntry)
	{
		this.updateStarIcon();
	}


	private selectServer(server: ServerEntry)
	{
		this.addrInput.value = server.address;
		if(server.rawStatus)
		{
			console.info(server.rawStatus);
		}
		this.updateStarIcon();
	}


	protected override onAfterAttach(msg: Message): void
	{
		super.onAfterAttach(msg);
		widgetSelf.WebSocketMonitor.serverResponse.connect(this.subResponse);

		// Instantiating attached child TerminalWidget
		if(!this.terminalWidget)
		{
			this.terminalWidget = new TerminalWidget('console', 'RCON Console');
		}
		if(this.terminalContainer && !this.terminalWidget.isAttached)
		{
			Widget.attach(this.terminalWidget, this.terminalContainer);
		}

		this.openMasters();
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
		widgetSelf.WebSocketMonitor.serverResponse.disconnect(this.subResponse);
		this.mastersSidebar?.addServer.disconnect(this.subAdd);
		this.mastersSidebar?.removeServer.disconnect(this.subRemove);
		this.mastersSidebar?.serverSelected.disconnect(this.subSelect);

		this.mastersSidebar?.close();
		super.onBeforeDetach(msg);
	}

	protected override onBeforeHide(msg: Message): void
	{
		// this.shutdownNetworking();
		this.mastersSidebar?.close();
		super.onBeforeHide(msg);
	}

	/* ------------------------------------------------------------------ */
	/* 1. DOM & Lumino Layout Builder                                     */
	/* ------------------------------------------------------------------ */
	private buildLayout(): void
	{
		// Top Toolbar
		const topBar = document.createElement('div');
		topBar.className = 'sc-top-toolbar';

		const reconnectBtn = document.createElement('button');
		reconnectBtn.className = 'sc-btn';
		reconnectBtn.innerHTML = `<i class='bx bx-rotate-ccw'></i> Reconnect`;
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

		this.node.appendChild(topBar);
		this.node.appendChild(this.terminalContainer);
		this.node.appendChild(this.commandBarEl);

	}

	private toggleCurrentFavorite(): void
	{
		const addr = this.addrInput.value;
		if(!addr || !this.mastersSidebar) return;

		const existingIdx = this.mastersSidebar.favorites.findIndex(f => f.address === addr);
		if(existingIdx >= 0)
		{
			this.mastersSidebar.favorites.splice(existingIdx, 1);
		} else
		{
			this.mastersSidebar.addFavoriteByAddress(addr);
		}
		this.updateStarIcon();
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

	private updateStarIcon(): void
	{
		if(!this.mastersSidebar)
		{
			return;
		}
		const isFav = this.mastersSidebar.favorites.some(f => f.address === this.addrInput.value);
		this.favStarBtn.innerHTML = isFav ? `<i class='bx bxs-star' style='color:#fbc02d;'></i>` : `<i class='bx bx-star'></i>`;
	}


	private handleIncomingQ3Packet(fromAddr: string, data: Uint8Array): void
	{
		const text = new TextDecoder().decode(data);

		// Handle Master Server Response: getserversResponse
		// if(text.includes('getserversResponse'))
		// {
		// 	this.parseMasterServerResponse(data);
		// 	return;
		// }

		// Handle Individual Server Response: statusResponse
		// if(text.includes('statusResponse'))
		// {
		// 	this.parseStatusResponse(fromAddr, text);
		// 	return;
		// }

		// Print raw out-of-band RCON/Server responses directly to terminal
		// if(this.terminalWidget && typeof (this.terminalWidget as any).write === 'function')
		// {
		// 	(this.terminalWidget as any).write(text.replace(/\xFF\xFF\xFF\xFF/g, '') + '\r\n');
		// }
	}


	// parseMasterServerResponse(data: Uint8Array<ArrayBufferLike>)
	// {
	// 	throw new Error('Method not implemented.');
	// }

	// parseStatusResponse(fromAddr: string, text: string)
	// {
	// 	throw new Error('Method not implemented.');
	// }


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
			widgetSelf.WebSocketMonitor.sendQ3UDPMessage(addr.split(':')[0], parseInt(addr.split(':')[1] || '27960', 10), `rcon ${pass} status`);
		} else
		{
			widgetSelf.WebSocketMonitor.sendQ3UDPMessage(addr.split(':')[0], parseInt(addr.split(':')[1] || '27960', 10), `getstatus`);
		}
	}

}


const LOCAL_SETTINGS: Record<string, Record<string, SettingConfig>> = {
	terminal: {
		masterServers: {
			key: 'masters_list',
			default: [],
			type: 'json',
			description: 'List of master servers listing other servers.',
		},
		favoriteServers: {
			key: 'favorites_list',
			default: [],
			type: 'json',
			description: 'List of servers you favorited.'
		}
	},

};


if(!widgetSelf.IMPORT_SETTINGS)
{
	widgetSelf.IMPORT_SETTINGS = {};
}

for(const [moduleKey, configs] of Object.entries(LOCAL_SETTINGS))
{
	widgetSelf.IMPORT_SETTINGS[moduleKey] = {
		...(widgetSelf.IMPORT_SETTINGS[moduleKey] || {}),
		...configs
	};
}

export const IMPORT_SETTINGS = widgetSelf.IMPORT_SETTINGS;
