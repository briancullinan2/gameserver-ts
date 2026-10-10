import { Widget } from '@lumino/widgets';
import { Message } from '@lumino/messaging';
import type { LuminoLayoutWindow } from '../bundle/lumino.d';
import type { GlobalToolbarsWindow, LuminoMenuWindow, RepositorySettingsWindow } from '../bundle/menu.d';
import type { ISocketMessage, WebSocketMonitor } from '../rcon/websocket';
import type { SettingConfig } from '../bundle/settings';
import { VirtualRendererManager } from './widget-virtual';
import type * as pdfjsLib from 'pdfjs-dist';
import './pdf.min.mjs';
import { RenderParameters } from 'pdfjs-dist/types/src/display/api';

const widgetSelf: GlobalToolbarsWindow & LuminoLayoutWindow & LuminoMenuWindow
	& RepositorySettingsWindow & {
		WebSocketMonitor: typeof WebSocketMonitor,
		pdfjsLib: typeof pdfjsLib;
	} = self as unknown as any;

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
	private previewContainer?: HTMLDivElement;
	private previewFrame?: HTMLIFrameElement;
	private iframeMode: boolean = false;
	private offscreenCanvas?: HTMLCanvasElement;

	// Sidebar & Signals
	// private mastersSidebar?: MasterListWidget;
	// private subSelect: (_: any, args: IServerSelectedArgs) => void = (_, args) => this.selectServer(args.item);
	// private subAdd: (_: any, args: IAddServerArgs) => void = (_, args) => this.addServer(args.item);
	// private subRemove: (_: any, args: IRemoveServerArgs) => void = (_, args) => this.removeServer(args.item);
	private subResponse: (_: any, args: ISocketMessage) => void = (_, args) => this.handleIncomingHTTPResponse(args.address, args.data);
	private previewCanvas?: HTMLCanvasElement;
	private previewContext?: CanvasRenderingContext2D | null;
	private activeEngine: 'happy-dom' | 'jsdom' | 'none' = 'none';
	private canvasSent: boolean = false;
	private initialize?: Promise<void> | undefined;
	private textLayer?: HTMLDivElement;
	private rendering?: Promise<void>;

	constructor(title?: string)
	{
		super();
		this.addClass('sc-widget-container');
		this.addClass('sc-mini-browser');
		this.title.label = title ?? 'Mini Browser';
		this.title.iconClass = 'bx bx-globe';
		this.title.closable = true;

		this.buildLayout();
		if(!widgetSelf.WebSocketMonitor)
		{
			this.initialize = widgetSelf.preloadDependencies?.(['/components/rcon/websocket.ts'])
				.then(() =>
					widgetSelf.WebSocketMonitor.initQ3Socks5Networking()
				);
		}
		else
		{
			widgetSelf.WebSocketMonitor.initQ3Socks5Networking();
		}
	}

	/* ------------------------------------------------------------------ */
	/* 1. DOM Layout Setup                                                */
	/* ------------------------------------------------------------------ */
	private async buildLayout(): Promise<void>
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
		this.node.appendChild(topBar);

		this.previewContainer = document.createElement('div');
		this.previewContainer.className = 'sc-viewport-wrapper';

		// Frame Viewport Container
		if(this.iframeMode)
		{
			this.previewFrame = document.createElement('iframe');
			this.previewFrame.className = 'sc-preview-frame';
			// Sandboxed: scripts disabled for XSS protection, allowing basic layout & same-origin styling rules
			this.previewFrame.setAttribute('sandbox', 'allow-same-origin');

			this.previewContainer.appendChild(this.previewFrame);
		} else
		{
			this.previewCanvas = document.createElement('canvas');
			this.previewCanvas.className = 'sc-preview-canvas';
			this.previewContext = this.previewCanvas.getContext('2d');
			this.offscreenCanvas = document.createElement('canvas');
			this.offscreenCanvas.className = 'sc-preview-canvas';
			this.textLayer = document.createElement('div');
			this.textLayer.className = 'textLayer';
			this.textLayer.style.position = 'absolute';
			this.textLayer.style.left = '0';
			this.textLayer.style.right = '0';
			this.textLayer.style.bottom = '0';
			this.textLayer.style.top = '0';
			this.textLayer.style.overflow = 'hidden';
			this.textLayer.style.opacity = '0.2';
			this.textLayer.style.lineHeight = '1.0';
			this.previewContainer.appendChild(this.offscreenCanvas);
			this.previewContainer.appendChild(this.previewCanvas);
			this.previewContainer.appendChild(this.textLayer);
		}

		this.node.appendChild(this.previewContainer);

		this.showLoading(this.addrInput.value);
	}



	private async showLoading(url?: string): Promise<void>
	{
		if(this.previewFrame)
		{
			this.previewFrame.src = 'data:text/html;base64,' + btoa(BrowserWidget.LOADING_DOCUMENT.replace('${url}', url ?? ''));
			return;
		}

		if(!this.previewContext) return;

		const rawContent = BrowserWidget.LOADING_DOCUMENT.replace('${url}', url ?? '');

		// 1. Convert HTML void tags to self-closing XHTML tags for SVG XML compliance
		const xhtmlContent = rawContent
			.replace(/<(img|br|hr|input|meta|link)([^>]*?)(?<!\/)>/gi, '<$1$2 />');

		// 2. Frame strictly-compliant SVG string
		const svgString = `
			<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
				<foreignObject width="100%" height="100%">
					<div xmlns="http://www.w3.org/1999/xhtml" style="background:#ffffff; color:#000000; font-family:sans-serif; width:100%; height:100%;">
						${xhtmlContent}
					</div>
				</foreignObject>
			</svg>
		`.trim();

		const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
		const imageUrl = URL.createObjectURL(blob);

		try
		{
			// 3. Prefer Image loading pipeline over createImageBitmap(blob) for SVG foreignObject stability
			const img = new Image();
			img.src = imageUrl;

			await new Promise<void>((resolve, reject) =>
			{
				img.onload = () => resolve();
				img.onerror = (e) => reject(new Error('SVG rasterization failed. Check XML compliance or external resource rules.'));
			});

			// Clear canvas background and draw
			this.previewContext.fillStyle = 'transparent';
			this.previewContext.fillRect(0, 0, 800, 600);
			this.previewContext.drawImage(img, 0, 0);
		}
		catch(err)
		{
			console.error('[BrowserWidget] SVG foreignObject render failed, using Canvas 2D fallback:', err);

			// 4. Clean Canvas Fallback UI
			this.previewContext.fillStyle = '#181818';
			this.previewContext.fillRect(0, 0, 800, 600);

			this.previewContext.fillStyle = '#4caf50';
			this.previewContext.font = 'bold 18px sans-serif';
			this.previewContext.fillText(`Loading...`, 30, 50);

			this.previewContext.fillStyle = '#aaaaaa';
			this.previewContext.font = '14px monospace';
			this.previewContext.fillText(`Target: ${url ?? 'about:blank'}`, 30, 80);
			this.previewContext.fillText(`Engine: ${this.activeEngine || 'HappyDOM'}`, 30, 105);
		}
		finally
		{
			// Always revoke object URL to prevent memory leaks
			URL.revokeObjectURL(imageUrl);
		}
	}

	// 1. Add a class property to track the active render task
	private renderTask: any = null;
	private async loadPDF(data: ArrayBuffer): Promise<void>
	{
		// If a render is already in progress, wait for it to finish first
		if(this.rendering)
		{
			await this.rendering;
		}

		// Create and capture the rendering promise immediately to lock out concurrent calls
		this.rendering = (async () =>
		{
			widgetSelf.pdfjsLib.GlobalWorkerOptions.workerSrc =
				'/components/ripper/pdf.worker.min.mjs';

			if(this.renderTask)
			{
				this.renderTask.cancel();
				this.renderTask = null;
			}

			try
			{
				const loadingTask: pdfjsLib.PDFDocumentLoadingTask = widgetSelf.pdfjsLib.getDocument({
					data,
					cMapUrl: '/components/ripper/cmaps/',
					cMapPacked: true,
				});
				const pdf = await loadingTask.promise;

				console.log('PDF loaded');
				const pageNumber = 1;
				const page = await pdf.getPage(pageNumber);

				console.log('Page loaded');
				const canvas = this.previewContext?.canvas;
				if(!canvas || !this.previewContext) return;

				const unscaledViewport = page.getViewport({ scale: 1.0 });
				const targetScale = canvas.clientWidth / unscaledViewport.width;
				const viewport = page.getViewport({ scale: targetScale });

				const outputScale = window.devicePixelRatio || 1;
				canvas.width = Math.floor(viewport.width * outputScale);
				canvas.height = Math.floor(viewport.height * outputScale);

				const transform = outputScale !== 1
					? [outputScale, 0, 0, outputScale, 0, 0]
					: undefined;

				const renderContext: RenderParameters = {
					canvas: canvas,
					canvasContext: this.previewContext,
					viewport: viewport,
					transform: transform,
					background: 'rgba(255, 255, 255, 0)'
				};

				this.renderTask = page.render(renderContext);
				await this.renderTask.promise;
				console.log('Page rendered naturally');

				await this.renderPDFText(page);

			} catch(reason: any)
			{
				if(reason?.name === 'RenderingCancelledException')
				{
					console.log('Previous rendering task canceled');
				} else
				{
					console.error('PDF loading error:', reason);
				}
			} finally
			{
				this.renderTask = null;
			}
		})();

		return this.rendering;
	}

	private async renderPDFText(page: pdfjsLib.PDFPageProxy)
	{
		if(!this.textLayer) return;
		this.textLayer.innerHTML = '';

		// 1. Calculate scale to match your desired dimensions or container size
		//const containerWidth = this.textLayer.clientWidth || 600;
		//const unscaledViewport = page.getViewport({ scale: 1.0 });

		// Example: factoring in custom margin spacing if needed
		//const margin = 0; //40;
		//const targetWidth = containerWidth - (margin * 2);
		//const scale = targetWidth / unscaledViewport.width;

		const viewport = page.getViewport(); //({ scale: scale });

		// 2. Initialize and render the text layer
		const textLayer = new widgetSelf.pdfjsLib.TextLayer({
			textContentSource: await page.streamTextContent(),
			viewport: viewport,
			container: this.textLayer,
		});

		await textLayer.render();
		console.log('Text layer rendered');
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
		this.showLoading(this.addrInput.value);

		const payload = JSON.stringify({
			method: 'GET',
			url: url,
			auth: (user || pass) ? { user, pass } : undefined
		});

		const parsed = new URL(url);

		// Adapting sendQ3UDPMessage to route HTTP request through WebSocket middleware
		if(typeof widgetSelf.WebSocketMonitor.sendHTTPRequest === 'function')
		{
			const parsedPort = parseInt(parsed.port);
			widgetSelf.WebSocketMonitor.sendHTTPRequest(parsed.hostname, !isNaN(parsedPort) ? parsedPort : (parsed.protocol.includes('https') ? 443 : 80), payload);
		}
	}


	private async handleIncomingHTTPResponse(fromAddr: string, data: Uint8Array): Promise<void>
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
		if(this.previewFrame)
		{
			this.previewFrame.srcdoc = htmlContent; // sanitizedHtml;
		} else if(this.offscreenCanvas)
		{
			this.canvasSent = true;
			const pdf = await VirtualRendererManager.init({
				html: htmlContent,
				targetUrl: targetUrl,
				canvasEl: !this.canvasSent ? this.offscreenCanvas : undefined,
				height: this.offscreenCanvas?.clientHeight,
				width: this.offscreenCanvas?.clientWidth,
			});
			if(pdf instanceof ArrayBuffer)
			{
				this.rendering = this.loadPDF(pdf);
			}
		}
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
	private async renderFrameError(title: string, detail: string): Promise<void>
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
		if(this.previewFrame)
		{
			this.previewFrame.srcdoc = errorHtml;
		}
		else if(this.offscreenCanvas)
		{
			const svgString = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${800}" height="${600}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="background:#ffffff; color:#000000; font-family:sans-serif;">
          ${errorHtml}
        </div>
      </foreignObject>
    </svg>
  `;

			const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
			const imageUrl = URL.createObjectURL(blob);

			try
			{
				const imageBitmap = await createImageBitmap(blob);
				this.previewContext?.drawImage(imageBitmap, 0, 0);
				URL.revokeObjectURL(imageUrl);
			} catch(err)
			{
				console.error(err);
				// Fallback text rendering if foreignObject SVG parsing fails or is restricted
				if(this.previewContext)
				{
					this.previewContext.fillStyle = '#333333';
					this.previewContext.font = '16px sans-serif';
					this.previewContext.fillText(`Virtual DOM Updated [Engine: ${this.activeEngine}]: ${err}`, 20, 40);
				}
			}
		}
	}


	/* ------------------------------------------------------------------ */
	/* 3. Lumino Lifecycle & Master List Connections                      */
	/* ------------------------------------------------------------------ */
	protected override async onAfterAttach(msg: Message): Promise<void>
	{
		super.onAfterAttach(msg);
		if(this.initialize)
		{
			await this.initialize;
		}
		widgetSelf.WebSocketMonitor.serverResponse.connect(this.subResponse);
		// this.openMasters();
		requestAnimationFrame(() =>
		{

			VirtualRendererManager.init({
				html: BrowserWidget.LOADING_DOCUMENT.replace('${url}', this.addrInput.value),
				targetUrl: this.addrInput.value,
				canvasEl: !this.canvasSent ? this.offscreenCanvas : undefined,
				height: this.offscreenCanvas?.clientHeight,
				width: this.offscreenCanvas?.clientWidth,
			});
			this.canvasSent = true;

			this.navigate();
		});
	}

	protected override onBeforeDetach(msg: Message): void
	{
		widgetSelf.WebSocketMonitor.serverResponse.disconnect(this.subResponse);
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
