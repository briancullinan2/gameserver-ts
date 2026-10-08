export interface IRendererInitOptions
{
	workerUrl?: string;
	html: string;
	targetUrl?: string;
	canvasEl?: HTMLCanvasElement;
}

export interface IPDFExportOptions
{
	orientation?: 'portrait' | 'landscape';
	format?: 'a4' | 'letter';
}

export class VirtualRendererManager
{
	private static worker: Worker | null = null;
	private static isInitialized = false;

	/**
	 * Initializes the Worker thread, boots JSDOM, and transfers OffscreenCanvas ownership.
	 */
	public static init(options: IRendererInitOptions): Promise<void>
	{
		return new Promise((resolve, reject) =>
		{
			if(this.worker)
			{
				this.worker.terminate();
			}

			const workerPath = options.workerUrl || './virtual-renderer.worker.js';
			this.worker = new Worker(workerPath);

			let offscreenCanvas: OffscreenCanvas | undefined = undefined;
			const transferables: Transferable[] = [];

			if(options.canvasEl)
			{
				offscreenCanvas = options.canvasEl.transferControlToOffscreen();
				transferables.push(offscreenCanvas);
			}

			this.worker.onmessage = (event: MessageEvent) =>
			{
				const { type } = event.data;
				if(type === 'RENDER_COMPLETE')
				{
					this.isInitialized = true;
					resolve();
				}
			};

			this.worker.onerror = (err) =>
			{
				reject(err);
			};

			this.worker.postMessage(
				{
					type: 'INIT',
					payload: {
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
	 * Sends a coordinate click interaction to the worker's JSDOM tree.
	 */
	public static sendClick(x: number, y: number): Promise<{ targetTag: string; }>
	{
		return new Promise((resolve, reject) =>
		{
			if(!this.worker || !this.isInitialized)
			{
				return reject(new Error('VirtualRendererManager is not initialized.'));
			}

			const handleResponse = (event: MessageEvent) =>
			{
				if(event.data.type === 'INTERACTION_COMPLETE')
				{
					this.worker?.removeEventListener('message', handleResponse);
					resolve(event.data.payload);
				}
			};

			this.worker.addEventListener('message', handleResponse);
			this.worker.postMessage({
				type: 'CLICK_INTERACTION',
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
			if(!this.worker || !this.isInitialized)
			{
				return reject(new Error('VirtualRendererManager is not initialized.'));
			}

			const handleResponse = (event: MessageEvent) =>
			{
				if(event.data.type === 'PNG_EXPORTED')
				{
					this.worker?.removeEventListener('message', handleResponse);
					const blob = new Blob([event.data.payload.buffer], { type: 'image/png' });
					resolve(blob);
				}
			};

			this.worker.addEventListener('message', handleResponse);
			this.worker.postMessage({ type: 'EXPORT_PNG' });
		});
	}

	/**
	 * Requests an in-browser PDF print output generated from the worker's virtual DOM state.
	 */
	public static exportPDF(options?: IPDFExportOptions): Promise<Blob>
	{
		return new Promise((resolve, reject) =>
		{
			if(!this.worker || !this.isInitialized)
			{
				return reject(new Error('VirtualRendererManager is not initialized.'));
			}

			const handleResponse = (event: MessageEvent) =>
			{
				if(event.data.type === 'PDF_EXPORTED')
				{
					this.worker?.removeEventListener('message', handleResponse);
					const blob = new Blob([event.data.payload.buffer], { type: 'application/pdf' });
					resolve(blob);
				}
			};

			this.worker.addEventListener('message', handleResponse);
			this.worker.postMessage({
				type: 'EXPORT_PDF',
				payload: { options }
			});
		});
	}

	/**
	 * Terminates the active worker instance.
	 */
	public static dispose(): void
	{
		if(this.worker)
		{
			this.worker.terminate();
			this.worker = null;
			this.isInitialized = false;
		}
	}
}
