// @ts-check

/* ======================================================================== */
/* 0. SAFE DEPENDENCY IMPORTING WITH ISOLATED ERROR HANDLING                */
/* ======================================================================== */

/** @type {Worker & GlobalWorkerScope & HtmlWorkerSelf} */
const workerSelf = /** @type {any} */ (self);

workerSelf.window = self;

workerSelf.document = {

};

/**
 * Safely load a script dependency without throwing unhandled exceptions.
 * @param {string} scriptPath
 * @returns {boolean}
 */
function safeImportScript(scriptPath)
{
	try
	{
		importScripts(scriptPath);
		return true;
	} catch(err)
	{
		console.warn(`[WorkerRenderer] Failed to import optional dependency (${scriptPath}):`, err);
		return false;
	}
}

// Individually import dependencies so one failure doesn't halt execution
const hasHappyDOM = safeImportScript('/components/ripper/happydom.bundle.js?t=' + Date.now()) || safeImportScript('https://cdn.jsdelivr.net/npm/happy-dom@13.3.0/dist/happy-dom.js');
const hasJSDOM = safeImportScript('/components/ripper/jsdom.bundle.js?t=' + Date.now()) || safeImportScript('https://cdn.jsdelivr.net/npm/jsdom@24.0.0/lib/jsdom.js');
const hasJSPDF = safeImportScript('/components/ripper/jspdf.umd.min.js?t=' + Date.now()) || safeImportScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
workerSelf.WebSocketMonitor?.serverResponse.connect((_, args) => handleIncomingHTTPResponse(args.address, args.data));

/* ======================================================================== */
/* TYPE DEFINITIONS                                                         */
/* ======================================================================== */

/**
 * @typedef {Object} WorkerInitPayload
 * @property {string} html
 * @property {string} [url]
 * @property {OffscreenCanvas} [canvas]
 * @property {'happy-dom' | 'jsdom' | 'auto'} [engine]
 */

/**
 * @typedef {Object} WorkerClickPayload
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {Object} WorkerPDFPayload
 * @property {import('jspdf').jsPDFOptions} [options]
 */


/**
 * @typedef {Object} IncomingWorkerMessage
 * @property {keyof WorkerEventMap} type
 * @property {WorkerInitPayload & WorkerClickPayload & WorkerPDFPayload} payload
 */

/**
 * @typedef {Object} GlobalWorkerScope
 * @property {typeof import('../rcon/websocket').WebSocketMonitor} [WebSocketMonitor]
 * @property {import('happy-dom')} [HappyDOM]
 * @property {import('happy-dom').Window} [Window]
 * @property {typeof import('jsdom')} [jsdom]
 * @property {{ jsPDF: new (options?: import('jspdf').jsPDFOptions) => import('jspdf').jsPDF }} [jspdf]
 * @property {(message: any, transferables?: Transferable[]) => void} postMessage
 * @property {(event: MessageEvent<IncomingWorkerMessage>) => Promise<void> | void} onmessage
 * @property {(win: Window, jspdfLibrary: any, options: import('./happy-pdf').PDFGenerationOptions) => Promise<ArrayBuffer>} [generatePDFFromVirtualDOM]
 * @property {((doc: Document | import('happy-dom').Document) => Record<string, Element[]>)} [extractAndTagElements]
 * @property {typeof import('../rcon/websocket').WebSocketMonitor} [WebSocketMonitor]
 */

/* ======================================================================== */
/* STATE VARIABLES                                                          */
/* ======================================================================== */

/**
 * @typedef {Object} HtmlWorkerSelf
 * @property {import('happy-dom').Window | any | undefined | null | null} [activeWindow]
 * @property {import('happy-dom').Document | undefined | null} [activeDocument]
 * @property {OffscreenCanvas | undefined | null} [offscreenCanvas]
 * @property {OffscreenCanvasRenderingContext2D | undefined | null} [canvasCtx]
 * @property {'happy-dom' | 'jsdom' | 'none'} [activeEngine]
 * @property {any | Document | import('happy-dom').Document} [document]
 * @property {any | Window | import('happy-dom').Window} [window]
 * @property {number} [innerHeight]
 * @property {number} [innerWidth]
 * @property {() => void} [cloneToDocument]
 */


/* ======================================================================== */
/* 1. VIRTUAL DOM INITIALIZATION (HAPPY DOM / JSDOM DUAL ENGINE)            */
/* ======================================================================== */


/**
 * Creates and configures a virtual document using Happy DOM (preferred) or JSDOM (fallback).
 * @param {string} html
 * @param {string} [url]
 * @param {'happy-dom' | 'jsdom' | 'auto'} [preferredEngine]
 * @returns {void}
 */
function createVirtualDOM(html, url = 'https://virtual.local/', preferredEngine = 'auto')
{
	let initialized = false;
	if(workerSelf.document)
	{
		initialized = true;
		workerSelf.document.open();
		// @ts-ignore
		document.baseURI = url;
		document.write(html);
		return;
	}

	// 1. Try Happy DOM First
	if((preferredEngine === 'happy-dom' || preferredEngine === 'auto') && workerSelf.HappyDOM)
	{
		try
		{
			if(typeof workerSelf.Window !== 'function')
			{
				throw new Error('HappyDOM Window constructor is not a valid class/function');
			}

			const happyWindow = new /** @type {new(opt: any) => import('happy-dom').Window} */(workerSelf.Window)({
				url: url,
				settings: {
					//disableJavaScriptEvaluation: false,
					//disableCSSFileLoading: true
				}
			});

			workerSelf.activeWindow = happyWindow;
			workerSelf.activeDocument = happyWindow.document;
			workerSelf.cloneToDocument?.();

			if(workerSelf.activeDocument)
			{
				let processedHtml = html;

				processedHtml = processedHtml.replace(/<link\b([^>]*\brel=["']stylesheet["'][^>]*)>/gi, (match, attrs) =>
				{
					const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
					const href = hrefMatch ? hrefMatch[1] : '';
					return `<stylesheet src="${href}"></stylesheet>`;
				});
				processedHtml = processedHtml.replace(/<link\b([^>]*\bhref=["'][^"']+["'][^>]*\brel=["']stylesheet["'][^>]*)>/gi, (match, attrs) =>
				{
					const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
					const href = hrefMatch ? hrefMatch[1] : '';
					return `<stylesheet src="${href}"></stylesheet>`;
				});
				processedHtml = processedHtml.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, content) =>
				{
					const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
					if(srcMatch)
					{
						return `<javascript src="${srcMatch[1]}"></javascript>`;
					} else
					{
						return `<javascript>${content}</javascript>`;
					}
				});

				workerSelf.activeDocument.write(processedHtml);
			}

			workerSelf.activeEngine = 'happy-dom';
			initialized = true;
		} catch(err)
		{
			console.warn('[WorkerRenderer] Happy DOM initialization failed, attempting fallback:', err);
		}
	}

	// 2. Fallback to JSDOM if Happy DOM is unavailable or failed
	if(!initialized && (preferredEngine === 'jsdom' || preferredEngine === 'auto') && workerSelf.jsdom)
	{
		try
		{
			const dom = new workerSelf.jsdom.JSDOM(html, {
				url: url,
				referrer: url,
				contentType: 'text/html',
				//runScripts: 'dangerously',
				//resources: 'usable'
			});

			workerSelf.activeWindow = dom.window;
			workerSelf.activeDocument = workerSelf.activeWindow ? workerSelf.activeWindow.document : null;
			workerSelf.cloneToDocument?.();

			workerSelf.activeEngine = 'jsdom';
			initialized = true;
		} catch(err)
		{
			console.warn('[WorkerRenderer] JSDOM initialization failed:', err);
		}
	}

	if(!initialized || !workerSelf.activeWindow || !workerSelf.activeDocument)
	{
		workerSelf.activeEngine = 'none';
		console.error('[WorkerRenderer] Critical Error: No DOM Engine available to render HTML.');
		return;
	}

	// Mask Window Properties against Frame / Worker Detection
	Object.defineProperty(workerSelf.activeWindow, 'top', { get: () => workerSelf.activeWindow });
	Object.defineProperty(workerSelf.activeWindow, 'parent', { get: () => workerSelf.activeWindow });
	Object.defineProperty(workerSelf.activeWindow, 'frameElement', { get: () => null });

	// Mock RequestAnimationFrame APIs
	workerSelf.activeWindow.requestAnimationFrame = (/** @type {FrameRequestCallback} */ cb) => setTimeout(() => cb(performance.now()), 1000 / 60);
	workerSelf.activeWindow.cancelAnimationFrame = (/** @type {number} */ id) => clearTimeout(id);

	// Mock Canvas Context for Inline DOM Canvas Elements
	const origCreateCanvas = workerSelf.activeDocument.createElement.bind(workerSelf.activeDocument);
	/**
	*
	* @param {string} tagName
	* @param {ElementCreationOptions} options
	* @returns
	*/
	workerSelf.activeDocument.createElement = function (tagName, options)
	{
		const el = origCreateCanvas(tagName, options);
		if(tagName.toLowerCase() === 'canvas')
		{
			/** @type {HTMLCanvasElement} */
			const canvas = /** @type {any} */(el);
			const internalCanvas = new OffscreenCanvas(300, 150);

			/**
			* @param {OffscreenRenderingContextId} contextId
			* @param {any} [contextAttributes]
			* @returns {any}
			*/
			canvas.getContext = (contextId, contextAttributes) => internalCanvas.getContext(contextId, contextAttributes);
			canvas.toDataURL = () => '';
		}
		return el;
	};
}

/* ======================================================================== */
/* 2. RENDERERS: PNG GENERATION & PDF EXPORT                                */
/* ======================================================================== */

/**
 * Renders the virtual DOM elements into the transferred OffscreenCanvas
 * @returns {Promise<ImageBitmap | ArrayBuffer | undefined>}
 */
async function renderToCanvas()
{
	if(!workerSelf.offscreenCanvas || !workerSelf.canvasCtx || !workerSelf.activeDocument) return;

	const width = workerSelf.offscreenCanvas.width || 800;
	const height = workerSelf.offscreenCanvas.height || 600;

	// Render SVG foreignObject representation of the virtual HTML
	const htmlString = workerSelf.activeDocument.documentElement ? workerSelf.activeDocument.documentElement.outerHTML : workerSelf.activeDocument.body.outerHTML;
	const svgString = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="background:transparent; color:#000000; font-family:sans-serif;">
          ${htmlString}
        </div>
      </foreignObject>
    </svg>
  `;

	const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
	const url = URL.createObjectURL(blob);

	try
	{
		const imageBitmap = await createImageBitmap(blob);

		// Clear canvas background
		// workerSelf.canvasCtx.fillStyle = '#ffffff';
		// workerSelf.canvasCtx.fillRect(0, 0, width, height);

		workerSelf.canvasCtx.drawImage(imageBitmap, 0, 0);
		URL.revokeObjectURL(url);
		return imageBitmap;
	} catch(err)
	{
		console.error(err);
		// Fallback text rendering if foreignObject SVG parsing fails or is restricted
		// workerSelf.canvasCtx.fillStyle = '#333333';
		// workerSelf.canvasCtx.font = '16px sans-serif';
		// workerSelf.canvasCtx.fillText(`Virtual DOM Updated [Engine: ${workerSelf.activeEngine}]`, 20, 40);
	}
}

/* ======================================================================== */
/* 3. MESSAGE DISPATCHER & INTERACTION HANDLER                              */
/* ======================================================================== */

workerSelf.onmessage = async (event) =>
{
	const { type, requestId, payload, } = event.data;
	const { height, width } = payload;

	switch(type)
	{
		case 'INIT': {
			const { html, url, canvas, engine, } = payload;
			if(canvas)
			{
				workerSelf.offscreenCanvas = canvas;
				workerSelf.canvasCtx = workerSelf.offscreenCanvas?.getContext('2d');
			}
			workerSelf.WebSocketMonitor?.initQ3Socks5Networking();
			createVirtualDOM(html, url, engine);
			if(workerSelf.activeDocument)
			{
				const elements = workerSelf.extractAndTagElements?.(workerSelf.activeDocument);
				for(const el of /** @type {HTMLScriptElement[]} */(elements?.script ?? []))
				{
					await navigate(el.src);
					// TODO: report browser files back to front end for network traffic monitor
				}
				debugger;
			}
			// give the page time to settle
			await workerSelf.activeWindow.happyDOM.whenAsyncComplete();
			if(typeof height === 'number')
			{
				workerSelf.innerHeight = height;
				workerSelf.window.innerHeight = height;
			}
			if(typeof width === 'number')
			{
				workerSelf.innerWidth = width;
				workerSelf.window.innerWidth = width;
			}
			const bitmap = await renderToCanvas();
			let pdf;
			if(!bitmap)
			{
				pdf = await workerSelf.generatePDFFromVirtualDOM?.(
					workerSelf.activeWindow,
					workerSelf.jspdf,
					height && width
						? {
							format: [pxToPt(width), pxToPt(height)],
							unit: 'pt'
						}
						: {}
				);
			}

			workerSelf.postMessage(pdf
				? { requestId, type: 'RENDER_COMPLETE', pdf: pdf }
				: { requestId, type: 'RENDER_COMPLETE', bitmap: bitmap });
			break;
		}

		case 'CLICK_INTERACTION': {
			const { requestId, x, y } = payload;
			if(!workerSelf.activeDocument || !workerSelf.activeWindow) return;

			// Resolve element at coordinate or default to body
			const targetEl = /** @type {HTMLElement | null} */ (workerSelf.activeDocument.elementFromPoint
				? workerSelf.activeDocument.elementFromPoint(x, y)
				: null)
				|| workerSelf.activeDocument.body;

			if(targetEl)
			{
				try
				{
					const MouseEventCtor = workerSelf.activeWindow.MouseEvent || MouseEvent;
					const mouseOverEvent = new MouseEventCtor('mouseover', { clientX: x, clientY: y, bubbles: true });
					const mouseDownEvent = new MouseEventCtor('mousedown', { clientX: x, clientY: y, bubbles: true });
					const clickEvent = new MouseEventCtor('click', { clientX: x, clientY: y, bubbles: true });

					targetEl.dispatchEvent(mouseOverEvent);
					targetEl.dispatchEvent(mouseDownEvent);
					targetEl.dispatchEvent(clickEvent);

					if(typeof targetEl.click === 'function')
					{
						targetEl.click();
					}
				} catch(err)
				{
					console.warn('[WorkerRenderer] Event dispatch warning:', err);
				}
			}

			const bitmap = await renderToCanvas();
			let pdf;
			if(!bitmap)
			{
				pdf = await workerSelf.generatePDFFromVirtualDOM?.(
					workerSelf.activeWindow,
					workerSelf.jspdf,
					height && width
						? {
							format: [pxToPt(width), pxToPt(height)],
							unit: 'pt'
						}
						: {}
				);
			}
			workerSelf.postMessage({
				type: 'INTERACTION_COMPLETE',
				requestId,
				payload: pdf
					? { targetTag: targetEl ? targetEl.tagName : 'NONE', pdf: pdf }
					: { targetTag: targetEl ? targetEl.tagName : 'NONE', bitmap: bitmap }
			});
			break;
		}

		case 'EXPORT_PNG': {
			if(!workerSelf.offscreenCanvas) return;
			try
			{
				const blob = await workerSelf.offscreenCanvas.convertToBlob({ type: 'image/png' });
				const arrayBuffer = await blob.arrayBuffer();
				workerSelf.postMessage({ type: 'PNG_EXPORTED', payload: { buffer: arrayBuffer } }, [arrayBuffer]);
			} catch(err)
			{
				console.error('[WorkerRenderer] PNG Export failed:', err);
			}
			break;
		}

		case 'EXPORT_PDF': {
			try
			{
				const pdfBuffer = await workerSelf.generatePDFFromVirtualDOM?.(
					workerSelf.activeWindow,
					workerSelf.jspdf,
					height && width
						? payload ? payload.options : {
							format: [pxToPt(width), pxToPt(height)],
							unit: 'pt'
						}
						: payload ? payload.options : undefined
				).catch;
				workerSelf.postMessage({ type: 'PDF_EXPORTED', payload: { buffer: pdfBuffer } }, /*[pdfBuffer]*/);
			} catch(err)
			{
				console.error('[WorkerRenderer] PDF Export failed:', err);
			}
			break;
		}
	}
};
const pxToPt = (/** @type {number} */ px) => px * 0.75;


/**
 *
 * @param {string} fromAddr
 * @param {Uint8Array} data
 * @returns {Promise<void>}
 */
async function handleIncomingHTTPResponse(fromAddr, data)
{
	if(!data || data.length === 0)
	{
		console.error('Empty Response', 'The server returned an empty response packet.');
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
				console.error(
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
				console.error(
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

}


/**
 *
 * @param {string} address
 * @returns
 */
function navigate(address)
{
	const url = address.trim();
	if(!url) return;

	//const user = this.userInput.value;
	//const pass = this.passInput.value;

	const requestId = generateGUID();
	const payload = JSON.stringify({
		method: 'GET',
		url: url,
		//	auth: (user || pass) ? { user, pass } : undefined
	});

	const parsed = new URL(url);

	// Adapting sendQ3UDPMessage to route HTTP request through WebSocket middleware
	if(typeof workerSelf.WebSocketMonitor?.sendHTTPRequest === 'function')
	{
		const parsedPort = parseInt(parsed.port);
		workerSelf.WebSocketMonitor.sendHTTPRequest(parsed.hostname, !isNaN(parsedPort) ? parsedPort : (parsed.protocol.includes('https') ? 443 : 80), payload);
	}
}

/**
 * Generates a standard RFC4122 v4 GUID
 * @returns {string}
 */
function generateGUID()
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
