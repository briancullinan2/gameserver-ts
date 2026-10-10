import { Window, Document, Element } from 'happy-dom';

const happySelf: Worker & {
	convertSizingToPercentages(doc: Document, win: Window): void;
	extractAndTagElements(doc: Document): Record<string, Element[]>;
	inlineCssStyles(doc: Document, win: Window): void;
} = self as unknown as any;

/**
 * 2. Scans the document, rewrites loading attributes to data-src-was,
 *    and returns a categorized record of elements by tag name.
 */
export function extractAndTagElements(doc: Document): Record<string, Element[]>
{
	const loadingAttributes = ['src', 'href', 'srcset', 'data-src', 'background', 'action'];
	const tagMap: Record<string, Element[]> = {};
	const allElements = Array.from(doc.querySelectorAll('*')) as Element[];

	allElements.forEach(el =>
	{
		const tagName = el.tagName.toLowerCase();
		let hasAttribute = false;


		// Convert loading attributes to data-src-was
		loadingAttributes.forEach(attr =>
		{
			if(el.hasAttribute(attr))
			{
				hasAttribute = true;
				const val = el.getAttribute(attr);
				if(val)
				{
					el.setAttribute(`data-src-was`, val);
					// Mark as pending for your proxy loader handler
					el.setAttribute(attr, '#proxy-pending');
				}
			}
		});
		if(hasAttribute)
		{
			// Populate tag record bucket
			if(!tagMap[tagName])
			{
				tagMap[tagName] = [];
			}
			tagMap[tagName].push(el);

		}

	});

	return tagMap;
}

happySelf.extractAndTagElements = extractAndTagElements;

/**
 * 1. Extracts final computed styles (which automatically handle inheritance and
 *    cascading up the tree) and applies them as direct inline style attributes.
 */
export function inlineCssStyles(doc: Document, win: Window): void
{
	const allElements = Array.from(doc.querySelectorAll('*')) as Element[];

	allElements.forEach(el =>
	{
		// Skip certain tags that don't need inline styling
		if(['script', 'style', 'head', 'meta', 'title', 'link'].includes(el.tagName.toLowerCase()))
		{
			return;
		}

		const computed = win.getComputedStyle(el as unknown as Element);
		if(!computed || computed.length === 0) return;

		const styles: string[] = [];

		// Iterate through computed style properties and inline them
		for(let i = 0; i < computed.length; i++)
		{
			const prop = computed.item(i);
			const val = computed.getPropertyValue(prop);

			// Only keep non-empty, meaningful style declarations
			if(val && val !== 'initial' && val !== 'none')
			{
				styles.push(`${prop}: ${val}`);
			}
		}

		if(styles.length > 0)
		{
			// Merge with any existing inline styles if present
			const existing = el.getAttribute('style') || '';
			const combined = `${existing}; ${styles.join('; ')}`
				.split(';')
				.map(s => s.trim())
				.filter(Boolean)
				.join('; ');

			el.setAttribute('style', combined);
		}
	});

	// Clean up external stylesheets/style tags since styles are now fully inlined
	doc.querySelectorAll('style, link[rel="stylesheet"]').forEach(tag => tag.remove());
}

happySelf.inlineCssStyles = inlineCssStyles;

/**
 * 2. Converts absolute pixel sizing properties into relative percentages
 *    based on parent container dimensions, with property deduplication for idempotency.
 */
export function convertSizingToPercentages(doc: Document, win: Window): void
{
	const allElements = Array.from(doc.querySelectorAll('*')) as Element[];

	allElements.forEach(el =>
	{
		if(['script', 'style', 'head', 'meta', 'title', 'link'].includes(el.tagName.toLowerCase()))
		{
			return;
		}

		const computed = win.getComputedStyle(el as unknown as Element);
		const parent = el.parentElement;
		if(!computed || !parent) return;

		const parentComputed = win.getComputedStyle(parent as unknown as Element);

		// Parent reference dimensions (fallback to 1 to avoid division by zero)
		const parentWidth = parseFloat(parentComputed.width) || 1;
		const parentHeight = parseFloat(parentComputed.height) || 1;
		const parentFontSize = parseFloat(parentComputed.fontSize) || 16;

		const widthProps = ['width', 'max-width', 'min-width', 'margin-left', 'margin-right', 'padding-left', 'padding-right', 'left', 'right'];
		const heightProps = ['height', 'max-height', 'min-height', 'margin-top', 'margin-bottom', 'padding-top', 'padding-bottom', 'top', 'bottom'];
		const fontProps = ['font-size', 'line-height'];

		const newStyles: string[] = [];

		for(let i = 0; i < computed.length; i++)
		{
			const prop = computed.item(i);
			const val = computed.getPropertyValue(prop);

			if(!val || val === 'initial' || val === 'none' || val === 'auto' || val === '0px')
			{
				continue;
			}

			if(val.endsWith('px'))
			{
				const numVal = parseFloat(val);
				if(isNaN(numVal)) continue;

				let percentage = 0;
				if(widthProps.includes(prop))
				{
					percentage = (numVal / parentWidth) * 100;
					newStyles.push(`${prop}: ${percentage.toFixed(2)}%`);
				}
				else if(heightProps.includes(prop) && parentHeight > 1)
				{
					percentage = (numVal / parentHeight) * 100;
					newStyles.push(`${prop}: ${percentage.toFixed(2)}%`);
				}
				else if(fontProps.includes(prop))
				{
					percentage = (numVal / parentFontSize) * 100;
					newStyles.push(`${prop}: ${percentage.toFixed(2)}%`);
				}
			}
		}

		if(newStyles.length > 0)
		{
			const existing = el.getAttribute('style') || '';

			// Combine and deduplicate by property name to guarantee idempotency on sequential runs
			const combined = `${existing}; ${newStyles.join('; ')}`
				.split(';')
				.map(s => s.trim())
				.filter(Boolean)
				.reduce((acc: string[], curr) =>
				{
					const propName = curr.split(':')[0].trim();
					// Filter out any prior definition of this property so it updates cleanly
					const filtered = acc.filter(item => !item.startsWith(propName + ':'));
					return [...filtered, curr];
				}, [])
				.join('; ');

			el.setAttribute('style', combined);
		}
	});
}

happySelf.convertSizingToPercentages = convertSizingToPercentages;
