import type { Window, Element, Node } from 'happy-dom';

export interface PDFGenerationOptions
{
	orientation?: 'portrait' | 'landscape';
	unit?: 'pt' | 'mm' | 'cm' | 'in';
	format?: string | number[];
}

const happySelf: {
	generatePDFFromVirtualDOM(
		win: Window,
		jspdfLibrary: any,
		options: PDFGenerationOptions
	): Promise<ArrayBuffer>;
} = self as unknown as any;

/**
 * Helper to convert CSS color strings (rgb, rgba, hex) to RGB tuples for jsPDF
 */
function parseCssColor(colorStr: string): [number, number, number] | null
{
	if(!colorStr || colorStr === 'transparent' || colorStr === 'rgba(0, 0, 0, 0)')
	{
		return null;
	}

	// Match rgb/rgba
	const rgbMatch = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
	if(rgbMatch)
	{
		return [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])];
	}

	// Match Hex (#rgb or #rrggbb)
	if(colorStr.startsWith('#'))
	{
		let hex = colorStr.slice(1);
		if(hex.length === 3)
		{
			hex = hex.split('').map(c => c + c).join('');
		}
		const num = parseInt(hex, 16);
		return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
	}

	return null;
}

/**
 * Generates high-fidelity PDF bytes using jsPDF by traversing Happy DOM nodes,
 * extracting computed CSS properties, and handling layout coordinates.
 */
export async function generatePDFFromVirtualDOM(
	win: Window,
	jspdfLibrary: any,
	options: PDFGenerationOptions = {}
): Promise<ArrayBuffer>
{
	if(!win || !win.document)
	{
		throw new Error('No Virtual DOM window/document initialized.');
	}
	if(!jspdfLibrary || !jspdfLibrary.jsPDF)
	{
		throw new Error('jsPDF library is not loaded.');
	}

	const { jsPDF } = jspdfLibrary;
	const doc = new jsPDF({
		orientation: options.orientation || 'portrait',
		unit: options.unit || 'pt',
		format: options.format || 'a4',
		putOnlyUsedFonts: true,
	});

	const pageWidth = doc.internal.pageSize.getWidth();
	const pageHeight = doc.internal.pageSize.getHeight();
	const margin = 40;
	const maxWidth = pageWidth - (margin * 2);

	let cursorX = margin;
	let cursorY = margin + 20;

	function checkPageBreak(neededHeight: number)
	{
		if(cursorY + neededHeight > pageHeight - margin)
		{
			doc.addPage();
			cursorY = margin + 20;
		}
	}

	function renderNode(node: Node)
	{
		if(!node) return;

		// 1. Handle Text Nodes
		if(node.nodeType === 3)
		{
			const text = node.textContent ? node.textContent.trim() : '';
			if(!text) return;

			const lines = doc.splitTextToSize(text, maxWidth);
			const lineHeight = doc.getFontSize() * 1.35;

			for(const line of lines)
			{
				checkPageBreak(lineHeight);
				doc.text(line, cursorX, cursorY);
				cursorY += lineHeight;
			}
			return;
		}

		// 2. Handle Element Nodes
		if(node.nodeType === 1)
		{
			const el = node as unknown as Element;
			const tagName = el.tagName ? el.tagName.toLowerCase() : '';

			// Skip structural meta/script tags
			if(['style', 'script', 'head', 'meta', 'link', 'title'].includes(tagName))
			{
				return;
			}

			// Extract computed styles to respect CSS definitions
			const computed = win.getComputedStyle(el as unknown as Element);

			// Skip hidden elements
			if(computed)
			{
				const display = computed.getPropertyValue('display');
				const visibility = computed.getPropertyValue('visibility');
				const opacity = computed.getPropertyValue('opacity');

				if(display === 'none' || visibility === 'hidden' || opacity === '0')
				{
					return;
				}
			}

			// Save previous font state for restoration post-children
			const prevFontSize = doc.getFontSize();
			const prevTextColor = doc.getTextColor ? doc.getTextColor() : [0, 0, 0];

			try
			{
				// Apply computed styles to jsPDF context
				if(computed)
				{
					// Font Size
					const fontSizePx = parseFloat(computed.getPropertyValue('font-size')) || 12;
					// Convert px to pt roughly (1px = 0.75pt)
					doc.setFontSize(fontSizePx * 0.75);

					// Font Weight & Style mapping
					const fontWeight = computed.getPropertyValue('font-weight');
					const fontStyle = computed.getPropertyValue('font-style');
					let jsStyle = 'normal';
					if((fontWeight && parseInt(fontWeight) >= 600) || fontWeight === 'bold')
					{
						jsStyle = fontStyle === 'italic' ? 'bolditalic' : 'bold';
					} else if(fontStyle === 'italic')
					{
						jsStyle = 'italic';
					}
					doc.setFont('helvetica', jsStyle);

					// Text Color
					const colorRgb = parseCssColor(computed.getPropertyValue('color'));
					if(colorRgb)
					{
						doc.setTextColor(colorRgb, colorRgb, colorRgb);
					}

					// Background Fill (if background color is set and visible)
					const bgRgb = parseCssColor(computed.getPropertyValue('background-color'));
					if(bgRgb && tagName !== 'body' && tagName !== 'html')
					{
						doc.setFillColor(bgRgb, bgRgb, bgRgb);
						// Approximate block rectangle rendering based on cursor flow
						const approxHeight = (parseFloat(computed.getPropertyValue('height')) || 20) * 0.75;
						checkPageBreak(approxHeight);
						doc.rect(cursorX, cursorY - 10, maxWidth, approxHeight, 'F');
					}
				}

				// Handle tag-specific layout margins or spacers
				if(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName))
				{
					cursorY += 8;
				} else if(tagName === 'hr')
				{
					checkPageBreak(15);
					doc.setLineWidth(1);
					doc.setDrawColor(218, 220, 224);
					doc.line(cursorX, cursorY, pageWidth - margin, cursorY);
					cursorY += 15;
					return;
				}

				// Recurse child nodes
				for(const child of Array.from(el.childNodes))
				{
					renderNode(child);
				}

				// Post-block spacing
				if(['h1', 'h2', 'h3', 'p', 'div', 'ul', 'ol', 'blockquote', 'section', 'article'].includes(tagName))
				{
					cursorY += 6;
				}

			} finally
			{
				// Restore font state defaults
				doc.setFontSize(prevFontSize);
				if(Array.isArray(prevTextColor))
				{
					doc.setTextColor(prevTextColor, prevTextColor, prevTextColor);
				}
			}
		}
	}

	// Start traversal from body or fallback to document root
	const rootTarget = win.document.body ?? win.document.documentElement;
	if(rootTarget)
	{
		renderNode(rootTarget as unknown as Node);
	} else
	{
		const bodyText = win.document.textContent || '';
		const lines = doc.splitTextToSize(bodyText, maxWidth);
		doc.text(lines, cursorX, cursorY);
	}

	return doc.output('arraybuffer');
}

happySelf.generatePDFFromVirtualDOM = generatePDFFromVirtualDOM;
