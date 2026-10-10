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
 * @property {import('happy-dom')} [HappyDOM]
 * @property {import('happy-dom').Window} [Window]
 * @property {typeof import('jsdom')} [jsdom]
 * @property {{ jsPDF: new (options?: import('jspdf').jsPDFOptions) => import('jspdf').jsPDF }} [jspdf]
 * @property {(message: any, transferables?: Transferable[]) => void} postMessage
 * @property {(event: MessageEvent<IncomingWorkerMessage>) => Promise<void> | void} onmessage
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
				workerSelf.activeDocument.write(html);
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
				runScripts: 'dangerously',
				resources: 'usable'
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

	// Clear canvas background
	workerSelf.canvasCtx.fillStyle = '#ffffff';
	workerSelf.canvasCtx.fillRect(0, 0, width, height);

	// Render SVG foreignObject representation of the virtual HTML
	const htmlString = workerSelf.activeDocument.documentElement ? workerSelf.activeDocument.documentElement.outerHTML : workerSelf.activeDocument.body.outerHTML;
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
		workerSelf.canvasCtx.drawImage(imageBitmap, 0, 0);
		URL.revokeObjectURL(url);
		return imageBitmap;
	} catch(err)
	{
		console.error(err);
		// Fallback text rendering if foreignObject SVG parsing fails or is restricted
		workerSelf.canvasCtx.fillStyle = '#333333';
		workerSelf.canvasCtx.font = '16px sans-serif';
		workerSelf.canvasCtx.fillText(`Virtual DOM Updated [Engine: ${workerSelf.activeEngine}]`, 20, 40);
	}
}


/**
 * Generates PDF bytes using jsPDF by traversing Happy DOM nodes in a Web Worker.
 * @param {import('jspdf').jsPDFOptions} [options]
 * @returns {Promise<ArrayBuffer>}
 */
async function generatePDF(options = {})
{
	if(!workerSelf.activeDocument) throw new Error('No Virtual DOM initialized.');
	if(!workerSelf.jspdf) throw new Error('jsPDF library is not loaded.');

	const { jsPDF } = workerSelf.jspdf;
	const doc = new jsPDF({
		orientation: options.orientation || 'portrait',
		unit: options.unit || 'pt',
		format: options.format || 'a4',
		putOnlyUsedFonts: true,
	});

	// Page dimension helpers (A4 default points: 595.28 x 841.89)
	const pageWidth = doc.internal.pageSize.getWidth();
	const pageHeight = doc.internal.pageSize.getHeight();
	const margin = 40; // 40pt margins
	const maxWidth = pageWidth - (margin * 2);

	let cursorX = margin;
	let cursorY = margin + 20; // Initial top offset

	/**
	 * Helper to check and handle page overflow
	 * @param {number} neededHeight
	 */
	function checkPageBreak(neededHeight)
	{
		if(cursorY + neededHeight > pageHeight - margin)
		{
			doc.addPage();
			cursorY = margin + 20;
		}
	}

	/**
	 * Recursive layout and render function for Happy DOM nodes
	 * @param {Node | import('happy-dom').Node | HTMLElement | import('happy-dom').HTMLElement | ChildNode | HTMLBodyElement | HTMLHtmlElement | import('happy-dom').HTMLBodyElement | import('happy-dom').HTMLHtmlElement} node
	 */
	function renderNode(node)
	{
		if(!node) return;

		// Handle Text Nodes
		if(node.nodeType === 3)
		{ // Node.TEXT_NODE
			const text = node.textContent ? node.textContent.trim() : '';
			if(!text) return;

			doc.setFont("helvetica", "normal");
			doc.setFontSize(10);
			doc.setTextColor(32, 33, 36);

			const lines = doc.splitTextToSize(text, maxWidth);
			const lineHeight = 14;

			for(const line of lines)
			{
				checkPageBreak(lineHeight);
				doc.text(line, cursorX, cursorY);
				cursorY += lineHeight;
			}
			return;
		}

		// Handle Element Nodes
		if(node.nodeType === 1)
		{ // Node.ELEMENT_NODE
			const tagName = 'tagName' in node ? node.tagName.toLowerCase() : node.constructor?.name?.toLowerCase();

			// Skip style/script or hidden tags
			if(['style', 'script', 'head', 'meta', 'link'].includes(tagName))
			{
				return;
			}

			// Apply tag-specific styling and layout rules
			let prevFontSize = doc.getFontSize();
			let prevFontStyling = 'normal'; // doc.getFontStyle ? doc.getFontStyle() : 'normal';

			switch(tagName)
			{
				case 'h1':
					checkPageBreak(40);
					doc.setFont("helvetica", "bold");
					doc.setFontSize(22);
					cursorY += 10;
					break;
				case 'h2':
					checkPageBreak(35);
					doc.setFont("helvetica", "bold");
					doc.setFontSize(18);
					cursorY += 8;
					break;
				case 'h3':
					checkPageBreak(30);
					doc.setFont("helvetica", "bold");
					doc.setFontSize(14);
					cursorY += 6;
					break;
				case 'p':
				case 'div':
					cursorY += 4;
					break;
				case 'hr':
					checkPageBreak(15);
					//doc.setDrawModel?.();
					doc.setLineWidth(1);
					doc.setDrawColor(218, 220, 224);
					doc.line(cursorX, cursorY, pageWidth - margin, cursorY);
					cursorY += 15;
					return;
				case 'strong':
				case 'b':
					doc.setFont("helvetica", "bold");
					break;
				case 'em':
				case 'i':
					doc.setFont("helvetica", "italic");
					break;
				default:
					break;
			}

			// Recurse child nodes
			for(const child of node.childNodes)
			{
				renderNode(child);
			}

			// Post-element spacing for block elements
			if(['h1', 'h2', 'h3', 'p', 'div', 'ul', 'ol', 'blockquote'].includes(tagName))
			{
				cursorY += 6;
			}

			// Restore font defaults
			doc.setFont("helvetica", prevFontStyling);
			doc.setFontSize(prevFontSize);
		}
	}

	// Start rendering from body if available, otherwise whole document
	/** @type {import('happy-dom').HTMLBodyElement} */
	const rootTarget = (workerSelf.activeDocument.body
		?? workerSelf.activeDocument.documentElement);
	if(rootTarget)
	{
		renderNode(rootTarget);
	} else
	{
		// Fallback to text extraction if no structural elements found
		const bodyText = workerSelf.activeDocument.textContent || '';
		const lines = doc.splitTextToSize(bodyText, maxWidth);
		doc.text(lines, cursorX, cursorY);
	}

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
			const { html, url, canvas, engine, height, width } = payload;
			if(canvas)
			{
				workerSelf.offscreenCanvas = canvas;
				workerSelf.canvasCtx = workerSelf.offscreenCanvas?.getContext('2d');
			}
			createVirtualDOM(html, url, engine);
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
				pdf = await generatePDF(height && width ? { format: [width, height], unit: 'px' } : {});
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
