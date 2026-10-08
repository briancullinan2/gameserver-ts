import { Widget } from '@lumino/widgets';
import { Message } from '@lumino/messaging';
import type { LuminoLayoutWindow } from '../bundle/lumino.d';
import type { GlobalToolbarsWindow, LuminoMenuWindow, RepositorySettingsWindow } from '../bundle/menu.d';
import { ISocketMessage, WebSocketMonitor } from '../rcon/websocket';
import type { SettingConfig } from '../bundle/settings';

const widgetSelf: GlobalToolbarsWindow & LuminoLayoutWindow & LuminoMenuWindow
	& RepositorySettingsWindow = self as unknown as any;

export interface ServerEntry
{
	id: string;
	name: string;
	address: string;
	mod: string;
	players: number;
	maxPlayers: number;
	when: Date;
	ping: number;
	hasBots: boolean;
	isFavorite: boolean;
	status: 'online' | 'offline' | 'pinging';
	rawStatus?: string;
	heartbeat?: Date;
}

export class BrowserWidget extends Widget
{
	private addrInput!: HTMLInputElement;
	private userInput!: HTMLInputElement;
	private passInput!: HTMLInputElement;
	private favStarBtn!: HTMLButtonElement;

	// Viewport & IFrame
	private iframeContainer!: HTMLDivElement;
	private previewFrame!: HTMLIFrameElement;

	// Sidebar & Signals
	// private mastersSidebar?: MasterListWidget;
	// private subSelect: (_: any, args: IServerSelectedArgs) => void = (_, args) => this.selectServer(args.item);
	// private subAdd: (_: any, args: IAddServerArgs) => void = (_, args) => this.addServer(args.item);
	// private subRemove: (_: any, args: IRemoveServerArgs) => void = (_, args) => this.removeServer(args.item);
	private subResponse: (_: any, args: ISocketMessage) => void = (_, args) => this.handleIncomingHTTPResponse(args.address, args.data);

	constructor(title?: string)
	{
		super();
		this.addClass('sc-widget-container');
		this.addClass('sc-mini-browser');
		this.title.label = title ?? 'Mini Browser';
		this.title.iconClass = 'bx bx-globe';
		this.title.closable = true;

		this.buildLayout();
		WebSocketMonitor.initQ3Socks5Networking();
	}

	/* ------------------------------------------------------------------ */
	/* 1. DOM Layout Setup                                                */
	/* ------------------------------------------------------------------ */
	private buildLayout(): void
	{
		// Top Address & Auth Bar
		const topBar = document.createElement('div');
		topBar.className = 'sc-top-toolbar';

		const goBtn = document.createElement('button');
		goBtn.className = 'sc-btn';
		goBtn.innerHTML = `<i class='bx bx-right-arrow-alt'></i> Go`;
		goBtn.addEventListener('click', () => this.navigate());

		this.addrInput = document.createElement('input');
		this.addrInput.type = 'text';
		this.addrInput.value =
			this.addrInput.placeholder = 'https://example.com';
		this.addrInput.style.flex = '3';
		this.addrInput.addEventListener('keydown', (e) =>
		{
			if(e.key === 'Enter') this.navigate();
		});

		this.userInput = document.createElement('input');
		this.userInput.type = 'text';
		this.userInput.placeholder = 'Auth User';
		this.userInput.style.flex = '1';

		this.passInput = document.createElement('input');
		this.passInput.type = 'password';
		this.passInput.placeholder = 'Auth Pass';
		this.passInput.style.flex = '1';

		this.favStarBtn = document.createElement('button');
		this.favStarBtn.className = 'sc-btn';
		this.favStarBtn.innerHTML = `<i class='bx bx-star'></i>`;
		this.favStarBtn.addEventListener('click', () => this.toggleCurrentFavorite());

		topBar.appendChild(this.addrInput);
		topBar.appendChild(this.userInput);
		topBar.appendChild(this.passInput);
		topBar.appendChild(goBtn);
		topBar.appendChild(this.favStarBtn);

		// Frame Viewport Container
		this.iframeContainer = document.createElement('div');
		this.iframeContainer.className = 'sc-viewport-wrapper';

		this.previewFrame = document.createElement('iframe');
		this.previewFrame.src = 'data:text/html;base64,' + btoa(BrowserWidget.LOADING_DOCUMENT.replace('${url}', '{about:blank}'));
		this.previewFrame.className = 'sc-preview-frame';
		// Sandboxed: scripts disabled for XSS protection, allowing basic layout & same-origin styling rules
		this.previewFrame.setAttribute('sandbox', 'allow-same-origin');

		this.iframeContainer.appendChild(this.previewFrame);

		this.node.appendChild(topBar);
		this.node.appendChild(this.iframeContainer);
	}


	private static LOADING_DOCUMENT = '<html><body style="background:#1e1e1e;color:#888;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">Loading ${url}...</body></html>';

	/* ------------------------------------------------------------------ */
	/* 2. Navigation & Socket HTTP Request Handling                       */
	/* ------------------------------------------------------------------ */
	private navigate(): void
	{
		const url = this.addrInput.value.trim();
		if(!url) return;

		const user = this.userInput.value;
		const pass = this.passInput.value;

		// Render loading state in iframe
		this.previewFrame.srcdoc = BrowserWidget.LOADING_DOCUMENT.replace('${url}', url);

		const payload = JSON.stringify({
			method: 'GET',
			url: url,
			auth: (user || pass) ? { user, pass } : undefined
		});

		const parsed = new URL(url);

		// Adapting sendQ3UDPMessage to route HTTP request through WebSocket middleware
		if(typeof WebSocketMonitor.sendHTTPRequest === 'function')
		{
			const parsedPort = parseInt(parsed.port);
			WebSocketMonitor.sendHTTPRequest(parsed.hostname, !isNaN(parsedPort) ? parsedPort : (parsed.protocol.includes('https') ? 443 : 80), payload);
		}
	}


	private handleIncomingHTTPResponse(fromAddr: string, data: Uint8Array): void
	{
		if(!data || data.length === 0)
		{
			this.renderFrameError('Empty Response', 'The server returned an empty response packet.');
			return;
		}

		const proxyContent = new TextDecoder().decode(data);
		let htmlContent = '';
		let targetUrl = '';
		let statusCode = 200;

		const trimmed = proxyContent.trim();

		// Check if the payload is a JSON wrapper
		if(trimmed.startsWith('{') && trimmed.endsWith('}'))
		{
			try
			{
				const responseData = JSON.parse(trimmed);

				// Handle Proxy Error Payload
				if(responseData.error)
				{
					this.renderFrameError(
						`Proxy Error [${responseData.code || 'ERR_PROXY'}]`,
						responseData.message || 'An error occurred while proxying the request.'
					);
					return;
				}

				statusCode = responseData.status ?? 200;
				targetUrl = responseData.url ?? '';
				htmlContent = responseData.data ?? '';

				// Handle HTTP Error Statuses (4xx, 5xx)
				if(statusCode >= 400)
				{
					this.renderFrameError(
						`HTTP ${statusCode} ${responseData.statusText || 'Error'}`,
						`Target URL: ${targetUrl}`
					);
					return;
				}
			} catch(err)
			{
				console.warn('[MiniBrowser] Failed to parse response JSON wrapper, treating as raw string:', err);
				htmlContent = proxyContent;
			}
		} else
		{
			htmlContent = proxyContent;
		}

		// Harden HTML Content before injecting into iframe
		// const sanitizedHtml = this.sanitizeScrapedHTML(htmlContent, targetUrl);

		// Inject sanitized HTML into the sandboxed iframe using srcdoc
		this.previewFrame.srcdoc = htmlContent; // sanitizedHtml;
	}


	/**
	 * Strips script blocks, event listeners, and injects base URL tag for relative asset loading.
	 */
	private sanitizeScrapedHTML(html: string, baseUrl?: string): string
	{
		if(!html) return '<html><body></body></html>';

		// 1. Remove all script tags and their contents
		let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

		// 2. Strip inline JavaScript event handlers (e.g., onclick="...", onload="...")
		clean = clean.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

		// 3. Strip javascript: URIs in href or src attributes
		clean = clean.replace(/(href|src)\s*=\s*["']?\s*javascript:[^"'>\s]+/gi, '$1="#"');

		// 4. Strip existing <base> tags so we can safely inject the correct target domain
		clean = clean.replace(/<base\b[^>]*>/gi, '');

		// 5. Inject <base href="..."> into <head> so relative CSS/images resolve properly
		if(baseUrl)
		{
			const baseTag = `<base href="${baseUrl}">`;
			if(/<head\b[^>]*>/i.test(clean))
			{
				clean = clean.replace(/<head\b[^>]*>/i, `$&${baseTag}`);
			} else
			{
				clean = `${baseTag}${clean}`;
			}
		}

		return clean;
	}

	/**
	 * Utility helper to display clean error UI directly in the preview frame
	 */
	private renderFrameError(title: string, detail: string): void
	{
		const errorHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    background-color: #181818;
                    color: #f44336;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                    padding: 20px;
                    box-sizing: border-box;
                    text-align: center;
                }
                h2 { margin: 0 0 10px 0; font-size: 1.2rem; }
                p { color: #aaa; font-size: 0.9rem; margin: 0; word-break: break-all; }
            </style>
        </head>
        <body>
            <h2>${title}</h2>
            <p>${detail}</p>
        </body>
        </html>
    `;
		this.previewFrame.srcdoc = errorHtml;
	}


	/* ------------------------------------------------------------------ */
	/* 3. Lumino Lifecycle & Master List Connections                      */
	/* ------------------------------------------------------------------ */
	protected override onAfterAttach(msg: Message): void
	{
		super.onAfterAttach(msg);
		WebSocketMonitor.serverResponse.connect(this.subResponse);
		// this.openMasters();
		requestAnimationFrame(() =>
		{
			this.navigate();
		});
	}

	protected override onBeforeDetach(msg: Message): void
	{
		WebSocketMonitor.serverResponse.disconnect(this.subResponse);
		// this.mastersSidebar?.addServer.disconnect(this.subAdd);
		// this.mastersSidebar?.removeServer.disconnect(this.subRemove);
		// this.mastersSidebar?.serverSelected.disconnect(this.subSelect);
		// this.mastersSidebar?.close();
		super.onBeforeDetach(msg);
	}

	protected override onBeforeHide(msg: Message): void
	{
		// this.mastersSidebar?.close();
		super.onBeforeHide(msg);
	}

	protected override onAfterShow(msg: Message): void
	{
		super.onAfterShow(msg);
		// this.openMasters();
		requestAnimationFrame(() =>
		{
			this.navigate();
		});
	}

	// private openMasters(): void
	// {
	// 	const that = this;
	// 	if(!this.mastersSidebar)
	// 	{
	// 		this.mastersSidebar = new MasterListWidget();
	// 		this.mastersSidebar.serverSelected.connect(this.subSelect);
	// 		this.mastersSidebar.removeServer.connect(this.subRemove);
	// 		this.mastersSidebar.addServer.connect(this.subAdd);
	// 	}
	// 	setTimeout(() =>
	// 	{
	// 		if(this.mastersSidebar && !this.mastersSidebar.isAttached)
	// 		{
	// 			if(widgetSelf.mainDock && widgetSelf.LayoutAdjuster && that.mastersSidebar)
	// 			{
	// 				widgetSelf.LayoutAdjuster?.addOptimalWidgetLayout(widgetSelf.mainDock, that.mastersSidebar, {
	// 					type: 'outline',
	// 					projectId: that.mastersSidebar?.constructor.name
	// 				});
	// 			}
	// 		}
	// 	}, 300);
	// }

	private toggleCurrentFavorite(): void
	{
		const addr = this.addrInput.value;
		// if(!addr || !this.mastersSidebar) return;

		// const existingIdx = this.mastersSidebar.favorites.findIndex(f => f.address === addr);
		// if(existingIdx >= 0)
		// {
		// 	this.mastersSidebar.favorites.splice(existingIdx, 1);
		// } else
		// {
		// 	this.mastersSidebar.addFavoriteByAddress(addr);
		// }
		this.updateStarIcon();
	}

	private addServer(server?: ServerEntry): void { this.updateStarIcon(); }
	private removeServer(server?: ServerEntry): void { this.updateStarIcon(); }

	private selectServer(server: ServerEntry): void
	{
		this.addrInput.value = server.address;
		this.updateStarIcon();
		this.navigate();
	}

	private updateStarIcon(): void
	{
		// if(!this.mastersSidebar) return;
		// const isFav = this.mastersSidebar.favorites.some(f => f.address === this.addrInput.value);
		// this.favStarBtn.innerHTML = isFav ? `<i class='bx bxs-star' style='color:#fbc02d;'></i>` : `<i class='bx bx-star'></i>`;
	}
}

/* ------------------------------------------------------------------ */
/* 4. Settings Import                                                 */
/* ------------------------------------------------------------------ */
const LOCAL_SETTINGS: Record<string, Record<string, SettingConfig>> = {
	miniBrowser: {
		bookmarks: {
			key: 'browser_bookmarks',
			default: [],
			type: 'json',
			description: 'List of scraped bookmark links and history.',
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
