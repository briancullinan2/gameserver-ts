import { Window, Document, Element } from 'happy-dom';

const happySelf: Worker & {
	extractAndTagElements(doc: Document): Record<string, Element[]>;
	inlineCssStyles(doc: Document, win: Window): void;
} = self as unknown as any;

/**
 * 2. Scans the document, rewrites loading attributes to data-src-was,
 *    and returns a categorized record of elements by tag name.
 */
export function extractAndTagElements(doc: Document): Record<string, Element[]>
{
	const loadingAttributes = ['src', 'href', 'srcset', 'data-src', 'background'];
	const tagMap: Record<string, Element[]> = {};
	const allElements = Array.from(doc.querySelectorAll('*')) as Element[];

	allElements.forEach(el =>
	{
		const tagName = el.tagName.toLowerCase();

		// Populate tag record bucket
		if(!tagMap[tagName])
		{
			tagMap[tagName] = [];
		}
		tagMap[tagName].push(el);

		// Convert loading attributes to data-src-was
		loadingAttributes.forEach(attr =>
		{
			if(el.hasAttribute(attr))
			{
				const val = el.getAttribute(attr);
				if(val)
				{
					el.setAttribute(`data-src-was`, val);
					// Mark as pending for your proxy loader handler
					el.setAttribute(attr, '#proxy-pending');
				}
			}
		});
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
