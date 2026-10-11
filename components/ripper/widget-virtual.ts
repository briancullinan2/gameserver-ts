import type { LuminoLayoutWindow } from "../bundle/lumino.d";

export interface IRendererInitOptions
{
	workerUrl?: string;
	html: string;
	targetUrl?: string;
	canvasEl?: HTMLCanvasElement;
	height?: number;
	width?: number;
}

export interface IPDFExportOptions
{
	orientation?: 'portrait' | 'landscape';
	format?: 'a4' | 'letter';
}

interface PendingRequest<T = any>
{
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: any) => void;
}

const managerSelf: LuminoLayoutWindow & {
	VirtualRendererManager: typeof VirtualRendererManager;
} = self as unknown as any;

export class VirtualRendererManager
{
	private static worker: Worker | null = null;
	private static isInitialized = false;

	/** Active map tracking pending worker promises by request GUID */
	private static pendingRequests = new Map<string, PendingRequest>();

	/**
	 * Generates a standard RFC4122 v4 GUID
	 */
	public static generateGUID(): string
	{
		if(typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
		{
			return crypto.randomUUID();
		}
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) =>
		{
			const r = (Math.random() * 16) | 0;
			const v = c === 'x' ? r : (r & 0x3) | 0x8;
			return v.toString(16);
		});
	}

	/**
	 * Centralized message dispatcher for worker responses
	 */
	private static handleWorkerMessage(event: MessageEvent): void
	{
		const { type, payload, requestId, error } = event.data || {};

		// Route to registered request promise if a matching requestId exists
		if(requestId && managerSelf.VirtualRendererManager.pendingRequests.has(requestId))
		{
			const pending = managerSelf.VirtualRendererManager.pendingRequests.get(requestId)!;
			managerSelf.VirtualRendererManager.pendingRequests.delete(requestId);

			if(error)
			{
				return pending.reject(new Error(error));
			}

			switch(type)
			{
				case 'INIT_COMPLETE':
				case 'RENDER_COMPLETE':
					managerSelf.VirtualRendererManager.isInitialized = true;
					pending.resolve(event.data?.pdf ?? event.data?.bitmap);
					break;

				case 'INTERACTION_COMPLETE':
					pending.resolve(payload);
					break;

				case 'PNG_EXPORTED':
					{
						const blob = new Blob([payload.buffer], { type: 'image/png' });
						pending.resolve(blob);
					}
					break;

				case 'PDF_EXPORTED':
					{
						const blob = new Blob([payload.buffer], { type: 'application/pdf' });
						pending.resolve(blob);
					}
					break;

				default:
					pending.resolve(payload);
					break;
			}
		}
	}

	/**
	 * Centralized error handler
	 */
	private static handleWorkerError(err: ErrorEvent): void
	{
		console.error('[VirtualRendererManager] Worker error uncaught:', err);
		// Reject all active pending requests on a worker crash
		managerSelf.VirtualRendererManager.pendingRequests.forEach((pending) => pending.reject(err.error || new Error(err.message)));
		managerSelf.VirtualRendererManager.pendingRequests.clear();
	}

	/**
	 * Initializes the Worker thread, boots Virtual DOM, and transfers OffscreenCanvas ownership.
	 */
	public static init(options: IRendererInitOptions): Promise<ImageBitmap | Buffer>
	{
		return new Promise(async (resolve, reject) =>
		{
			const requestId = managerSelf.VirtualRendererManager.generateGUID();
			const transferables: Transferable[] = [];

			let offscreenCanvas: OffscreenCanvas | undefined = undefined;

			if(options.canvasEl)
			{
				offscreenCanvas = options.canvasEl.transferControlToOffscreen();
				transferables.push(offscreenCanvas);
			}

			if(!managerSelf.VirtualRendererManager.worker)
			{
				try
				{
					const workerPath = options.workerUrl || '/components/ripper/html-worker.js';
					await managerSelf.fetchAndStore?.(workerPath);
					managerSelf.VirtualRendererManager.worker = new Worker('/base' + workerPath + '?t=' + Date.now() + '&local-csp=true');

					managerSelf.VirtualRendererManager.worker.onmessage = (e) => managerSelf.VirtualRendererManager.handleWorkerMessage(e);
					managerSelf.VirtualRendererManager.worker.onerror = (e) => managerSelf.VirtualRendererManager.handleWorkerError(e);
				}
				catch(err)
				{
					return reject(err);
				}
			}

			// Register request promise with GUID
			managerSelf.VirtualRendererManager.pendingRequests.set(requestId, { resolve, reject });

			managerSelf.VirtualRendererManager.worker.postMessage(
				{
					type: 'INIT',
					requestId,
					payload: {
						height: options.height ?? options.canvasEl?.clientHeight,
						width: options.width ?? options.canvasEl?.clientWidth,
						html: options.html,
						url: options.targetUrl || 'https://virtual.local/',
						canvas: offscreenCanvas
					}
				},
				transferables
			);
		});
	}

	/**
	 * Sends a coordinate click interaction to the worker's DOM tree.
	 */
	public static sendClick(x: number, y: number): Promise<{ targetTag: string; }>
	{
		return new Promise((resolve, reject) =>
		{
			if(!managerSelf.VirtualRendererManager.worker || !managerSelf.VirtualRendererManager.isInitialized)
			{
				return reject(new Error('VirtualRendererManager is not initialized.'));
			}

			const requestId = managerSelf.VirtualRendererManager.generateGUID();
			managerSelf.VirtualRendererManager.pendingRequests.set(requestId, { resolve, reject });

			managerSelf.VirtualRendererManager.worker.postMessage({
				type: 'CLICK_INTERACTION',
				requestId,
				payload: { x, y }
			});
		});
	}

	/**
	 * Requests a PNG snapshot rendered from the worker's OffscreenCanvas.
	 */
	public static exportPNG(): Promise<Blob>
	{
		return new Promise((resolve, reject) =>
		{
			if(!managerSelf.VirtualRendererManager.worker || !managerSelf.VirtualRendererManager.isInitialized)
			{
				return reject(new Error('VirtualRendererManager is not initialized.'));
			}

			const requestId = managerSelf.VirtualRendererManager.generateGUID();
			managerSelf.VirtualRendererManager.pendingRequests.set(requestId, { resolve, reject });

			managerSelf.VirtualRendererManager.worker.postMessage({
				type: 'EXPORT_PNG',
				requestId
			});
		});
	}

	/**
	 * Requests an in-browser PDF print output generated from the worker's virtual DOM state.
	 */
	public static exportPDF(options?: IPDFExportOptions): Promise<Blob>
	{
		return new Promise((resolve, reject) =>
		{
			if(!managerSelf.VirtualRendererManager.worker || !managerSelf.VirtualRendererManager.isInitialized)
			{
				return reject(new Error('VirtualRendererManager is not initialized.'));
			}

			const requestId = managerSelf.VirtualRendererManager.generateGUID();
			managerSelf.VirtualRendererManager.pendingRequests.set(requestId, { resolve, reject });

			managerSelf.VirtualRendererManager.worker.postMessage({
				type: 'EXPORT_PDF',
				requestId,
				payload: { options }
			});
		});
	}

	/**
	 * Terminates the active worker instance and rejects all open requests.
	 */
	public static dispose(): void
	{
		if(managerSelf.VirtualRendererManager.worker)
		{
			managerSelf.VirtualRendererManager.worker.terminate();
			managerSelf.VirtualRendererManager.worker = null;
			managerSelf.VirtualRendererManager.isInitialized = false;

			managerSelf.VirtualRendererManager.pendingRequests.forEach((pending) => pending.reject(new Error('Worker disposed.')));
			managerSelf.VirtualRendererManager.pendingRequests.clear();
		}
	}
}

if(!managerSelf.VirtualRendererManager)
{
	managerSelf.VirtualRendererManager = VirtualRendererManager;
}
