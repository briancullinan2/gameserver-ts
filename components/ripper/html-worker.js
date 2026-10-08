// @ts-check

/* ======================================================================== */
/* 0. SAFE DEPENDENCY IMPORTING WITH ISOLATED ERROR HANDLING                */
/* ======================================================================== */

/** @type {Worker & GlobalWorkerScope} */
const workerSelf = /** @type {any} */ (self);

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

/* ======================================================================== */
/* TYPE DEFINITIONS                                                         */
/* ======================================================================== */

/**
 * @typedef {Object} IPDFOptions
 * @property {'portrait' | 'landscape'} [orientation]
 * @property {'pt' | 'mm' | 'cm' | 'in'} [unit]
 * @property {string | number[]} [format]
 */

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
 * @property {IPDFOptions} [options]
 */


/**
 * @typedef {Object} IncomingWorkerMessage
 * @property {keyof WorkerEventMap} type
 * @property {WorkerInitPayload & WorkerClickPayload & WorkerPDFPayload} payload
 */

/**
 * @typedef {Object} JSPDFInstance
 * @property {(text: string | string[], x: number, y: number) => void} text
 * @property {(text: string, maxLineWidth: number) => string[]} splitTextToSize
 * @property {(type: 'arraybuffer' | 'blob' | 'datauristring') => ArrayBuffer} output
 */

/**
 * @typedef {Object} GlobalWorkerScope
 * @property {import('happy-dom')} [HappyDOM]
 * @property {import('happy-dom').Window} [Window]
 * @property {typeof import('jsdom')} [jsdom]
 * @property {{ jsPDF: new (options?: IPDFOptions) => JSPDFInstance }} [jspdf]
 * @property {(message: any, transferables?: Transferable[]) => void} postMessage
 * @property {(event: MessageEvent<IncomingWorkerMessage>) => Promise<void> | void} onmessage
 */

/* ======================================================================== */
/* STATE VARIABLES                                                          */
/* ======================================================================== */

/** @type {any | null} */
let activeWindow = null;

/** @type {import('happy-dom').Document | undefined | null} */
let activeDocument = null;

/** @type {OffscreenCanvas | undefined | null} */
let offscreenCanvas = null;

/** @type {OffscreenCanvasRenderingContext2D | undefined | null} */
let canvasCtx = null;

/** @type {'happy-dom' | 'jsdom' | 'none'} */
let activeEngine = 'none';

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
					disableJavaScriptEvaluation: false,
					disableCSSFileLoading: true
				}
			});

			activeWindow = happyWindow;
			activeDocument = happyWindow.document;

			if(activeDocument)
			{
				activeDocument.write(html);
			}

			activeEngine = 'happy-dom';
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
				runScripts: 'dangerously',
				resources: 'usable'
			});

			activeWindow = dom.window;
			activeDocument = activeWindow ? activeWindow.document : null;
			activeEngine = 'jsdom';
			initialized = true;
		} catch(err)
		{
			console.warn('[WorkerRenderer] JSDOM initialization failed:', err);
		}
	}

	if(!initialized || !activeWindow || !activeDocument)
	{
		activeEngine = 'none';
		console.error('[WorkerRenderer] Critical Error: No DOM Engine available to render HTML.');
		return;
	}

	// Mask Window Properties against Frame / Worker Detection
	Object.defineProperty(activeWindow, 'top', { get: () => activeWindow });
	Object.defineProperty(activeWindow, 'parent', { get: () => activeWindow });
	Object.defineProperty(activeWindow, 'frameElement', { get: () => null });

	// Mock RequestAnimationFrame APIs
	activeWindow.requestAnimationFrame = (/** @type {FrameRequestCallback} */ cb) => setTimeout(() => cb(performance.now()), 1000 / 60);
	activeWindow.cancelAnimationFrame = (/** @type {number} */ id) => clearTimeout(id);

	// Mock Canvas Context for Inline DOM Canvas Elements
	const origCreateCanvas = activeDocument.createElement.bind(activeDocument);
	/**
	*
	* @param {string} tagName
	* @param {ElementCreationOptions} options
	* @returns
	*/
	activeDocument.createElement = function (tagName, options)
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
	if(!offscreenCanvas || !canvasCtx || !activeDocument) return;

	const width = offscreenCanvas.width || 800;
	const height = offscreenCanvas.height || 600;

	// Clear canvas background
	canvasCtx.fillStyle = '#ffffff';
	canvasCtx.fillRect(0, 0, width, height);

	// Render SVG foreignObject representation of the virtual HTML
	const htmlString = activeDocument.documentElement ? activeDocument.documentElement.outerHTML : activeDocument.body.outerHTML;
	const svgString = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="background:#ffffff; color:#000000; font-family:sans-serif;">
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
		canvasCtx.drawImage(imageBitmap, 0, 0);
		URL.revokeObjectURL(url);
		return imageBitmap;
	} catch(err)
	{
		console.error(err);
		// Fallback text rendering if foreignObject SVG parsing fails or is restricted
		canvasCtx.fillStyle = '#333333';
		canvasCtx.font = '16px sans-serif';
		canvasCtx.fillText(`Virtual DOM Updated [Engine: ${activeEngine}]`, 20, 40);
	}
}

/**
 * Generates PDF bytes using jsPDF
 * @param {IPDFOptions} [options]
 * @returns {Promise<ArrayBuffer>}
 */
async function generatePDF(options = {})
{
	if(!activeDocument) throw new Error('No Virtual DOM initialized.');
	if(!workerSelf.jspdf) throw new Error('jsPDF library is not loaded.');

	const { jsPDF } = workerSelf.jspdf;
	const doc = new jsPDF({
		orientation: options.orientation || 'portrait',
		unit: options.unit || 'pt',
		format: options.format || 'a4'
	});

	const bodyText = activeDocument.body ? (activeDocument.body.textContent || '') : '';

	// Format body content into PDF lines
	const lines = doc.splitTextToSize(bodyText, 500);
	doc.text(lines, 40, 60);

	return doc.output('arraybuffer');
}

/* ======================================================================== */
/* 3. MESSAGE DISPATCHER & INTERACTION HANDLER                              */
/* ======================================================================== */

workerSelf.onmessage = async (event) =>
{
	const { type, requestId, payload } = event.data;

	switch(type)
	{
		case 'INIT': {
			const { html, url, canvas, engine } = payload;
			if(canvas)
			{
				offscreenCanvas = canvas;
				canvasCtx = offscreenCanvas?.getContext('2d');
			}
			createVirtualDOM(html, url, engine);
			const bitmap = await renderToCanvas();
			let pdf;
			if(!bitmap)
			{
				pdf = await generatePDF();
			}

			workerSelf.postMessage(pdf
				? { requestId, type: 'RENDER_COMPLETE', pdf: pdf }
				: { requestId, type: 'RENDER_COMPLETE', bitmap: bitmap });
			break;
		}

		case 'CLICK_INTERACTION': {
			const { requestId, x, y } = payload;
			if(!activeDocument || !activeWindow) return;

			// Resolve element at coordinate or default to body
			const targetEl = /** @type {HTMLElement | null} */ (activeDocument.elementFromPoint ? activeDocument.elementFromPoint(x, y) : null) || activeDocument.body;

			if(targetEl)
			{
				try
				{
					const MouseEventCtor = activeWindow.MouseEvent || MouseEvent;
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
				pdf = await generatePDF();
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
			if(!offscreenCanvas) return;
			try
			{
				const blob = await offscreenCanvas.convertToBlob({ type: 'image/png' });
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
				const pdfBuffer = await generatePDF(payload ? payload.options : undefined);
				workerSelf.postMessage({ type: 'PDF_EXPORTED', payload: { buffer: pdfBuffer } }, [pdfBuffer]);
			} catch(err)
			{
				console.error('[WorkerRenderer] PDF Export failed:', err);
			}
			break;
		}
	}
};
