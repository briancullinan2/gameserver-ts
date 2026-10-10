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
 * @property {any | Document} [document]
 * @property {any | Window} [window]
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
					disableJavaScriptEvaluation: false,
					disableCSSFileLoading: true
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
 * Generates PDF bytes using jsPDF
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
	});

	if(workerSelf.activeDocument.body)
	{
		const colorReset = workerSelf.activeDocument.createElement('style');
		colorReset.innerText = `
* {
	-webkit-print-color-adjust: exact !important;
	print-color-adjust: exact !important;
	color-adjust: exact !important;
}

/* ==========================================================================
1. Chrome Base Reset & Web-to-Print Settings
========================================================================== */

:root {
  /* Default Web Mode Variables */
  --bg-color: transparent;
  --text-color: #202124;
  --secondary-color: #5f6368;
  --border-color: #dadce0;
  --link-color: #1a0dab;
  --code-bg: #f1f3f4;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}

/* Newsprint Theme Overrides */
body.theme-newsprint {
  --bg-color: transparent;
  --text-color: #1a1a1a;
  --secondary-color: #4a4a4a;
  --border-color: #c8c2b0;
  --link-color: #1a1a1a;
  --code-bg: #e8e1cf;
  --font-sans: "Georgia", "Times New Roman", "Times", serif;
}

/* Box Sizing & Layout Defaults */
*, *::before, *::after {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
  tab-size: 4;
}

body {
  margin: 0;
  padding: 1rem;
  background-color: var(--bg-color);
  color: var(--text-color);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;

  /* FORCE Chrome to keep background colors & graphics when generating PDF */
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
  color-adjust: exact !important;
}

/* Newsprint Column Layout for Main Body Content */
body.theme-newsprint main,
body.theme-newsprint article {
  column-count: 2;
  column-gap: 20px;
  column-rule: 1px solid var(--border-color);
}

/* ==========================================================================
   2. Typography & Text Elements
   ========================================================================== */

h1, h2, h3, h4, h5, h6 {
  margin-top: 1.2em;
  margin-bottom: 0.5em;
  color: var(--text-color);
  font-weight: 600;
  line-height: 1.25;
}

h1 { font-size: 2em; border-bottom: 1px solid var(--border-color); padding-bottom: 0.3em; }
h2 { font-size: 1.5em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
h5 { font-size: 0.875em; }
h6 { font-size: 0.85em; color: var(--secondary-color); }

p {
  margin-top: 0;
  margin-bottom: 1em;
}

small {
  font-size: 80%;
  color: var(--secondary-color);
}

b, strong {
  font-weight: 600;
}

em, i {
  font-style: italic;
}

mark {
  background-color: #fce8e6;
  color: var(--text-color);
  padding: 0.1em 0.2em;
}

/* ==========================================================================
   3. Links, Lists, and Blockquotes
   ========================================================================== */

a {
  color: var(--link-color);
  text-decoration: underline;
  text-decoration-skip-ink: auto;
}

ul, ol {
  margin-top: 0;
  margin-bottom: 1em;
  padding-left: 2em;
}

li {
  margin-bottom: 0.25em;
}

blockquote {
  margin: 1em 0;
  padding: 0.5em 1em;
  color: var(--secondary-color);
  border-left: 4px solid var(--border-color);
  background-color: transparent;
}

hr {
  height: 0;
  margin: 1.5em 0;
  border: 0;
  border-top: 1px solid var(--border-color);
}

/* ==========================================================================
   4. Code, Preformatted Text & Media
   ========================================================================== */

code, kbd, samp, pre {
  font-family: var(--font-mono);
  font-size: 0.9em;
}

code {
  padding: 0.2em 0.4em;
  background-color: var(--code-bg);
  border-radius: 3px;
}

pre {
  margin-top: 0;
  margin-bottom: 1em;
  padding: 1em;
  overflow: auto;
  background-color: var(--code-bg);
  border-radius: 4px;
}

pre code {
  padding: 0;
  background-color: transparent;
}

img, svg, video, canvas {
  max-width: 100%;
  height: auto;
  display: block;
}

/* ==========================================================================
   5. Tables & Forms
   ========================================================================== */

table {
  width: 100%;
  margin-bottom: 1em;
  border-collapse: collapse;
  text-align: left;
}

th, td {
  padding: 8px 12px;
  border: 1px solid var(--border-color);
}

th {
  font-weight: 600;
  background-color: var(--code-bg);
}

/* Form controls reset to look native/clean */
input, button, textarea, select {
  font-family: inherit;
  font-size: inherit;
  color: inherit;
  margin: 0;
}

/* ==========================================================================
   6. Chrome Print Engine Rules (@page & @media print)
   ========================================================================== */

@page {
  /* Chrome default A4 page setup with 1cm margins */
  size: A4;
  margin: 10mm;
}

@media print {
  body {
    padding: 0;
    background-color: var(--bg-color) !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  /* Prevent page cuts across elements */
  p, blockquote, table, pre, figure, img, tr, .no-break {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* Keep headings attached to their following text */
  h1, h2, h3, h4, h5, h6 {
    break-after: avoid;
    page-break-after: avoid;
  }

  /* Clean up printed links */
  a {
    text-decoration: none;
  }
}
		`;

		//if(activeDocument.body.childNodes.length)
		//{
		//activeDocument.body.insertBefore(colorReset, activeDocument.childNodes[0]);
		//} else
		{
			workerSelf.activeDocument.body.appendChild(colorReset);
		}
	}
	const bodyText = workerSelf.activeDocument.body ? (workerSelf.activeDocument.body.textContent || '') : '';

	if(false && workerSelf.activeDocument?.body)
	{
		debugger;
		await doc.html(/** @type {any | HTMLElement}*/(workerSelf.activeDocument?.body.children[0]), {
			callback: function (doc)
			{
				//document.body.removeChild(container);
			},
			x: 0,
			y: 0,
			autoPaging: 'text',
			html2canvas: {
				// Chrome's default print background flags
				backgroundColor: 'transparent',
				scale: 0.75, // Adjust scale to fit A4 width
				onclone: (clonedDoc) =>
				{
					// Force Chrome print color retention rules on the clone
					//clonedDoc.body.style.webkitPrintColorAdjust = 'exact';
					clonedDoc.body.style.printColorAdjust = 'exact';
				}
			}
		});
	} else
	{
		// Format body content into PDF lines
		const lines = doc.splitTextToSize(bodyText, 500);
		doc.text(lines, 40, 60);
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
			const { html, url, canvas, engine } = payload;
			if(canvas)
			{
				workerSelf.offscreenCanvas = canvas;
				workerSelf.canvasCtx = workerSelf.offscreenCanvas?.getContext('2d');
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
