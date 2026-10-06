// @ts-ignore
import { PluginObj, NodePath, transform, types as tType, traverse, packages } from '@babel/standalone';
import { DB_STORE_NAME, FS_FILE, putRecord } from './local';
import { SettingsManager } from './settings';
import { getGitShaBrowser } from './github-tools';
import { path } from './global';
import type { ComponentRoute } from './menu';
import type { LuminoLayoutWindow } from './lumino.d';

const parseBabel = packages.parser.parse;
const traverse = (packages as any).traverse.default;

const compileSelf: LuminoLayoutWindow & {
	[key: string]: any;
} = self as unknown as any;



export const registry = new Map<string, Promise<any>>(
	[...document.scripts]
		.map((s: HTMLScriptElement) => s.getAttribute('src'))
		.filter((src): src is string => Boolean(src))
		.concat([...document.styleSheets].map((s: CSSStyleSheet) => s.href).filter((href): href is string => Boolean(href)))
		.map((url: string): [string, Promise<any>] =>
		{
			const absoluteUrl = new URL(url, window.location.origin).pathname;
			// Pre-seed the Map with an instantly resolved promise for elements already loaded
			return [absoluteUrl, Promise.resolve()];
		})
);



export function collectDependencies(rawCode: string, baseRoute: string, dependenciesToFetch?: string[]): string[]
{

	dependenciesToFetch ??= [];

	const ast = parseBabel(rawCode, {
		sourceType: 'module',
		plugins: [
			'typescript' // Enables parsing of TS syntax like interfaces and type annotations
		]
	});

	// 2. Traverse the AST using a custom visitor
	traverse(ast as any, {
		ImportDeclaration(babelPath: NodePath<tType.ImportExpression>)
		{
			const moduleName = babelPath.node.source.value;
			if(babelPath.node.importKind === 'type')
			{
				console.log('Skipping type: ' + moduleName);
				return;
			} else
			{
				console.log('Overloading import: ' + moduleName);
			}

			let newDependency;

			if(moduleName === 'ace-builds')
			{
				newDependency = '/ace/ace-noconflict.js';
			} else if(moduleName === 'd3')
			{
				newDependency = '/components/status/d3.min.js';
			} else if(moduleName === 'fabric')
			{
				newDependency = '/components/writer/fabric.min.js';
			} else if(moduleName === 'marked')
			{
				newDependency = '/components/writer/marked.umd.js';
			} else if(moduleName === '@mlc-ai/web-llm')
			{
				newDependency = '/components/chat/mlc.mjs';
			} else if(moduleName === 'd3-cloud')
			{
				newDependency = '/components/blog/d3.layout.cloud.js';
			} else if(moduleName === './tree.js' && baseRoute)
			{
				newDependency = path.resolve(baseRoute.substring(0, baseRoute.lastIndexOf('/')), moduleName);
			} else if(moduleName === './bundle.js' && baseRoute)
			{
				newDependency = path.resolve(baseRoute.substring(0, baseRoute.lastIndexOf('/')), moduleName);
			} else if(moduleName === 'xterm' || moduleName === '@xterm/xterm')
			{
				newDependency = '/components/terminal/xterm.js';
			} else if(moduleName === 'litegraph.js')
			{
				newDependency = '/components/graph/litegraph.min.js';
			} else if((moduleName.startsWith('./') || moduleName.startsWith('../'))
				&& baseRoute?.includes('.'))
			{
				const ext = baseRoute.split('.').pop();
				const modifiedModuleName = moduleName + (!moduleName.split('/').pop()?.includes('.')
					? '.' + ext
					: '');
				newDependency = path.resolve(baseRoute.substring(0, baseRoute.lastIndexOf('/')),
					modifiedModuleName);
			}

			if(newDependency && !dependenciesToFetch.includes(newDependency))
			{
				dependenciesToFetch.push(newDependency);
			}
		},
		CallExpression(babelPath: NodePath<tType.CallExpression>)
		{
			if(
				((babelPath.node.callee as any).name === 'require'
					|| (babelPath.node.callee as any).name === 'import') &&
				babelPath.node.arguments.length === 1 &&
				babelPath.node.arguments[0].type === 'StringLiteral'
			)
			{
				const moduleName = babelPath.node.arguments[0].value;
				console.log('Overloading require: ' + moduleName);
				let newDependency;

				if(moduleName === './tree.js' && baseRoute)
				{
					newDependency = path.resolve(baseRoute.substring(0, baseRoute.lastIndexOf('/')), moduleName);
				} else if(moduleName === './bundle.js' && baseRoute)
				{
					newDependency = path.resolve(baseRoute.substring(0, baseRoute.lastIndexOf('/')), moduleName);
				} else if((moduleName === 'xterm' || moduleName === '@xterm/xterm') && baseRoute)
				{
					newDependency = '/components/terminal/xterm.js';
				} else if(moduleName === '@mlc-ai/web-llm')
				{
					newDependency = '/components/chat/mlc.mjs';
				} else if((moduleName === 'litegraph.js'))
				{
					newDependency = '/components/graph/litegraph.min.js';
				} else if((moduleName.startsWith('./') || moduleName.startsWith('../'))
					&& baseRoute?.includes('.'))
				{
					const ext = baseRoute.split('.').pop();
					const modifiedModuleName = moduleName + (!moduleName.split('/').pop()?.includes('.')
						? '.' + (ext ? ext : '.js')
						: '');
					newDependency = path.resolve(baseRoute.substring(0, baseRoute.lastIndexOf('/')),
						modifiedModuleName);
				}


				if(newDependency && !dependenciesToFetch.includes(newDependency))
				{
					dependenciesToFetch.push(newDependency);
				}
			}
		},

	});

	return dependenciesToFetch;
}


export async function preloadDependencies(dependenciesToFetch: string[]): Promise<void>
{
	if(dependenciesToFetch.length === 0)
	{
		return;
	}

	const allPromises: Promise<any>[] = [];
	for(let url of dependenciesToFetch)
	{
		const targetUrl = url.replace(/\.ts$/, '.js').replace(/^\.?\//, '/base/');
		const existingPromise = registry.get(targetUrl);
		if(existingPromise)
		{
			console.log('Skipping, already preloaded: ' + url);
			// circular dependencies
			//allPromises.push(existingPromise);
			continue;
		}

		console.log('Preloading: ' + url);

		if(url.endsWith('.ts'))
		{
			const scriptPromise = fetchTranspileAndStore(url, dependenciesToFetch)
				.then(targetUrl => import(/* webpackIgnore: true */ targetUrl + '?t=' + Date.now() + '&local-csp=true'));
			registry.set(targetUrl, scriptPromise);
			allPromises.push(scriptPromise);
		}
		else
		{
			const isPromise = loadScript(url);
			if(isPromise instanceof Promise)
			{
				allPromises.push(isPromise);
			}
		}
	}
	console.log('Waiting for ' + allPromises.length + ' piece of shit promises.');

	await Promise.all(allPromises);

	console.log('Finishing bullshit: ' + JSON.stringify(dependenciesToFetch));
}

compileSelf.preloadDependencies = preloadDependencies;
compileSelf.loadScript = loadScript;



// Add this definition to your class properties:
// private registry: Map<string, Promise<void>> = new Map();

async function loadStyle(href: string): Promise<void>
{
	const absoluteUrl: string = new URL(href, window.location.origin).pathname;
	const existingTheme: Element | null = document.querySelector('link[href*="/theme.css"]');

	// ─── THE CONCURRENCY LOCK CHECK ───
	const cachedPromise = registry.get(absoluteUrl);
	if(cachedPromise)
	{
		return cachedPromise;
	}

	const stylePromise = new Promise<void>((resolve, reject) =>
	{
		const link: HTMLLinkElement = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = href;

		link.onload = () => resolve();
		link.onerror = () =>
		{
			registry.delete(absoluteUrl); // Evict on failure
			reject(new Error(`Failed stylesheet mounting: ${href}`));
		};

		if(existingTheme)
		{
			document.head.insertBefore(link, existingTheme);
		} else
		{
			document.head.appendChild(link);
		}
	});

	registry.set(absoluteUrl, stylePromise);
	return stylePromise;
}


compileSelf.loadStyle = loadStyle;


// Define the class property registry somewhere above this method in your class:
// private registry = new Map<string, Promise<any>>();

export async function loadScript(src: string): Promise<any>
{
	const targetUrl = src.replace(/^\.?\//, '/base/');
	if(document.head.querySelector(`script[src*="${targetUrl}"]`))
	{
		console.warn('Already loaded bullshit: ' + src);
		return;
	}

	// Create the promise and cache it immediately to block secondary asset creation runs
	const scriptPromise = fetchAndStore(src)
		.then(([targetUrl, isModule]) => new Promise<void>((resolve, reject) =>
		{
			const script: HTMLScriptElement = document.createElement('script');
			script.src = targetUrl + '?t=' + Date.now() + '&local-csp=true';
			script.type = isModule ? 'module' : 'text/javascript';
			script.async = false; // Preserves literal script tree order
			console.log('Sourcing bullshit: ' + targetUrl);

			script.onload = () =>
			{
				console.log('Loaded bullshit: ' + targetUrl);
				resolve();
			};
			script.onerror = () =>
			{
				registry.delete(targetUrl); // Evict on failure so a retry can clear the pipe
				reject(new Error(`Failed execution pipeline: ${src}`));
			};

			document.head.appendChild(script);
		}));

	registry.set(targetUrl, scriptPromise);
	return scriptPromise;
}


export async function fetchAndStore(baseRoute: string, dependenciesToFetch?: string[]): Promise<[string, boolean]>
{
	dependenciesToFetch ??= [];

	const targetUrl = baseRoute.replace(/^\.?\//, '/base/');

	console.log('Fetching bullshit: ' + baseRoute);
	const response = await fetch(baseRoute + '?t=' + Date.now());
	const rawCode = await response.text();

	collectDependencies(rawCode, baseRoute, dependenciesToFetch);

	await preloadDependencies(dependenciesToFetch);

	const encoder = new TextEncoder();

	// 1. Safely convert the JSON string containing UTF-8 characters to base64
	const jsonString = JSON.stringify({
		version: 3,
		sources: [targetUrl],
		sourcesContent: [rawCode],
		names: [],
		mappings: '',
		ignoreList: []
	});

	// A safe UTF-8 base64 conversion using TextEncoder + u8 array mapping
	const jsonBytes = encoder.encode(jsonString);
	const binaryString = Array.from(jsonBytes, (byte) => String.fromCharCode(byte)).join('');
	const base64Json = btoa(binaryString);

	// 2. Concatenate your code with the safe base64 source map
	const completeCode = rawCode + '\n\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,' + base64Json;

	// 3. Convert the final string to your array buffer
	const arrayBuffer = encoder.encode(completeCode).buffer;

	const editorDatabase = SettingsManager.get('github', 'environmentRepository');

	// Commit the compiled asset to your service worker pipeline
	await putRecord(DB_STORE_NAME, {
		timestamp: new Date(),
		mode: FS_FILE,
		contents: arrayBuffer,
		path: targetUrl,
		parent: targetUrl.substring(0, targetUrl.lastIndexOf('/')),
		sha: await getGitShaBrowser(arrayBuffer)
	}, editorDatabase);

	return [targetUrl, !!rawCode.match(/^export\s/gmi)];
}



export async function fetchTranspileAndStore(baseRoute: string, dependenciesToFetch?: string[]): Promise<string>
{
	dependenciesToFetch ??= [];

	const targetUrl = baseRoute.replace(/\.ts$/, '.js').replace(/^\.?\//, '/base/');

	const existingPromise = registry.get(targetUrl);
	if(existingPromise)
	{
		console.log('Already transpiled: ' + targetUrl);
		return targetUrl;
	} else
	{
		console.log('Transpiling: ' + targetUrl);
	}

	const response = await fetch(baseRoute + '?t=' + Date.now());
	const rawCode = await response.text();

	if(!response.ok) throw new Error('Component not found: ' + baseRoute);
	if(!transform) throw new Error("Babel standalone runner not found on the window context.");

	collectDependencies(rawCode, baseRoute, dependenciesToFetch);

	console.log('Preloading dependencies: ' + baseRoute + ' : ' + JSON.stringify(dependenciesToFetch));

	await preloadDependencies(dependenciesToFetch);

	console.log('Done preloading, transpiling: ' + baseRoute);

	const transpiled = transpileTypescriptWidget(rawCode, baseRoute);
	const encoder = new TextEncoder();
	const arrayBuffer = encoder.encode(transpiled.code ?? '').buffer;

	// Direct the target URL from .ts to .js for the Service Worker's consumption
	const editorDatabase = SettingsManager.get('github', 'environmentRepository');

	console.log('Saving: ' + targetUrl);
	// Commit the compiled asset to your service worker pipeline
	await putRecord(DB_STORE_NAME, {
		timestamp: new Date(),
		mode: FS_FILE,
		contents: arrayBuffer,
		path: targetUrl,
		parent: targetUrl.substring(0, targetUrl.lastIndexOf('/')),
		sha: await getGitShaBrowser(arrayBuffer)
	}, editorDatabase);


	if(transpiled.map)
	{
		const sourceMapBuffer = encoder.encode(transpiled.map ?? '').buffer;
		await putRecord(DB_STORE_NAME, {
			timestamp: new Date(),
			mode: FS_FILE,
			contents: sourceMapBuffer,
			path: targetUrl.replace('.js', '.map'),
			parent: targetUrl.substring(0, targetUrl.lastIndexOf('/')),
			sha: await getGitShaBrowser(arrayBuffer)
		}, editorDatabase);
	}

	return targetUrl;
}



export function transpileTypescriptWidget(rawCode: string, baseRoute: string): any
{

	const transpiled = transform(rawCode, {
		presets: ['env'],
		sourceMaps: 'inline',
		plugins: [
			['transform-typescript', { isTSX: false }],
			function (babel: { types: typeof tType, template: any; }): PluginObj
			{
				const { types: t, template } = babel;
				return {
					visitor: {
						CallExpression(path: NodePath<tType.CallExpression>)
						{
							if(
								(path.node.callee as any).name === 'require' &&
								path.node.arguments.length === 1 &&
								path.node.arguments[0].type === 'StringLiteral'
							)
							{
								const moduleName = path.node.arguments[0].value;

								console.warn('replacing: ' + moduleName);

								// Map the Node modules cleanly to your exposed globals
								if(moduleName === '@lumino/widgets')
								{
									path.replaceWithSourceString('window.Lumino.widgets');
								} else if(moduleName === '@lumino/datagrid')
								{
									path.replaceWithSourceString('window.Lumino.datagrid');
								} else if(moduleName === '@lumino/messaging')
								{
									path.replaceWithSourceString('window.Lumino.messaging');
								} else if(moduleName === '@lumino/signaling')
								{
									path.replaceWithSourceString('window.Lumino.signaling');
								} else if(moduleName === '@mlc-ai/web-llm')
								{
									path.replaceWithSourceString('/components/chat/mlc.mjs');
								} else if(moduleName === '@lumino/commands')
								{
									path.replaceWithSourceString('window.Lumino.commands');
								} else if(moduleName === 'marked')
								{
									path.replaceWithSourceString('window');
								} else if(moduleName === 'fabric')
								{
									path.replaceWithSourceString('window.fabric');
								} else if(moduleName === './tree.js')
								{
									path.replaceWithSourceString('window.Tree');
								} else if(moduleName === 'litegraph.ks')
								{
									path.replaceWithSourceString('LiteGraph');
								} else if(moduleName === './bundle.js')
								{
									path.replaceWithSourceString('window');
								} else if(moduleName === '@mlc-ai/web-llm')
								{
									path.node.source = t.stringLiteral('/components/chat/mlc.mjs');
								} else if(moduleName === 'xterm' || moduleName === '@xterm/xterm')
								{
									path.replaceWithSourceString('Terminal');
								}
							}
						},
						ImportDeclaration(babelPath: NodePath<tType.ImportDeclaration>)
						{
							const moduleName = babelPath.node.source.value;
							let globalExpression: tType.Expression | null = null;

							console.warn('replacing: ' + moduleName);

							// Resolve the clean global base path node safely based on matching string declarations
							if(moduleName === '@lumino/widgets')
							{
								globalExpression = t.memberExpression(
									t.memberExpression(t.identifier('window'), t.identifier('Lumino')),
									t.identifier('widgets')
								);
							} else if(moduleName === '@lumino/messaging')
							{
								globalExpression = t.memberExpression(
									t.memberExpression(t.identifier('window'), t.identifier('Lumino')),
									t.identifier('messaging')
								);
							} else if(moduleName === '@lumino/datagrid')
							{
								globalExpression = t.memberExpression(
									t.memberExpression(t.identifier('window'), t.identifier('Lumino')),
									t.identifier('datagrid')
								);
							} else if(moduleName === '@lumino/signaling')
							{
								globalExpression = t.memberExpression(
									t.memberExpression(t.identifier('window'), t.identifier('Lumino')),
									t.identifier('signaling')
								);
							} else if(moduleName === 'ace-builds')
							{
								globalExpression = t.memberExpression(
									t.identifier('window'),
									t.identifier('ace')
								);
							} else if(moduleName === 'marked')
							{
								globalExpression = t.identifier('window');
							} else if(moduleName === 'fabric')
							{
								globalExpression = t.memberExpression(
									t.identifier('window'),
									t.identifier('fabric')
								);
							} else if(moduleName === './tree.js')
							{
								globalExpression = t.memberExpression(
									t.identifier('window'),
									t.identifier('Tree')
								);
							} else if(moduleName === 'd3')
							{
								globalExpression = t.memberExpression(
									t.identifier('window'),
									t.identifier('d3')
								);
							} else if(moduleName === 'd3-cloud')
							{
								globalExpression = t.memberExpression(
									t.identifier('window'),
									t.identifier('d3')
								);
							} else if(moduleName === './bundle.js')
							{
								globalExpression = t.identifier('window');
							} else if(moduleName === 'xterm' || moduleName === '@xterm/xterm')
							{
								globalExpression = t.identifier('window');
							} else if(moduleName === 'litegraph.js')
							{
								globalExpression = t.identifier('window');
							} else if(moduleName === '@mlc-ai/web-llm')
							{
								babelPath.node.source = t.stringLiteral('/components/chat/mlc.mjs');
							} else if(moduleName.startsWith('./') || moduleName.startsWith('../'))
							{
								const ext = baseRoute.split('.').pop();
								const modifiedModuleName = moduleName + (!moduleName.split('/').pop()?.includes('.')
									? '.' + (ext ? ext : '.js')
									: '');
								const newPath = path.resolve(baseRoute.substring(0, baseRoute.lastIndexOf('/')),
									modifiedModuleName).replace('.ts', '.js').replace(/^\.?\//, '/base/') + '?t=' + Date.now() + '&local-csp=true';
								console.warn(`Replacing import path: "${moduleName}" -> "${newPath}"`);
								babelPath.node.source = t.stringLiteral(newPath);
								return;
							}

							if(globalExpression)
							{
								const declarations: tType.VariableDeclaration[] = [];

								// Handle named imports safely: import { Widget, Panel } from '...'
								const specifiers = babelPath.node.specifiers.filter(
									(spec: any): spec is tType.ImportSpecifier => t.isImportSpecifier(spec)
								);

								if(specifiers.length > 0)
								{
									const properties = specifiers.map((spec: tType.ImportSpecifier) =>
									{
										const importedName = t.isIdentifier(spec.imported)
											? spec.imported.name
											: spec.imported.value;

										return t.objectProperty(
											t.identifier(importedName),
											t.identifier(spec.local.name),
											false,
											importedName === spec.local.name
										);
									});

									declarations.push(
										t.variableDeclaration('const', [
											t.variableDeclarator(
												t.objectPattern(properties),
												globalExpression!
											)
										])
									);
								}

								// Handle namespace/default imports smoothly: import * as widgets from '...' or import Tree from '...'
								const namespaceOrDefaultSpecifier = babelPath.node.specifiers.find(
									(spec: any) => t.isImportNamespaceSpecifier(spec) || t.isImportDefaultSpecifier(spec)
								);

								if(namespaceOrDefaultSpecifier)
								{
									declarations.push(
										t.variableDeclaration('const', [
											t.variableDeclarator(
												t.identifier(namespaceOrDefaultSpecifier.local.name),
												globalExpression!
											)
										])
									);
								}

								// Replace or drop the nodes cleanly to maintain content security standards
								if(declarations.length > 0)
								{
									babelPath.replaceWithMultiple(declarations);
								} else
								{
									babelPath.remove();
								}
							}
						}
					}
				};
			}
		],
		filename: baseRoute
	} as any);


	return transpiled;
}



export async function loadAndInstantiate(route: ComponentRoute): Promise<any>
{
	if(!route.url || !route.className)
	{
		throw new Error(`Route definition "${route.label}" is missing execution target pathways.`);
	}

	if(route.url.endsWith('.js'))
	{

		const modulePromise = import(/* webpackIgnore: true */ route.url + '?t=' + Date.now() + '&local-csp=true');
		registry.set(route.url, modulePromise);
		const module = await modulePromise;
		return new (module?.default?.[route.className] ?? module?.[route.className] ?? compileSelf[route.className])(route.label);
	}

	const targetUrl = route.url.replace(/\.ts$/, '.js').replace(/^\.\//, '/base/');
	const existingPromise = registry.get(targetUrl);
	if(existingPromise)
	{
		console.log('Already transpiled: ' + targetUrl);
		const module2 = await existingPromise;
		return new (module2?.default?.[route.className] ?? module2?.[route.className] ?? compileSelf[route.className])(route.label);
	}

	await fetchTranspileAndStore(route.url);

	console.log('Importing transpiled widget: ' + route.url);

	// Import directly from the pipeline URL rather than an ephemeral blob URL
	const modulePromise = import(/* webpackIgnore: true */ targetUrl + '?t=' + Date.now() + '&local-csp=true');
	registry.set(targetUrl, modulePromise);
	const module = await modulePromise;
	return new module[route.className](route.label);
}


/*
=======================================================================
Sys_CompileJsToWasmRef

Dynamically generates a minimal, isolated WebAssembly module in memory
that binds a JavaScript function to a true native WASM execution vector.
=======================================================================
*/
function Sys_CompileJsToWasmRef(jsFunction: Function, paramCount = 1)
{
	// WebAssembly Opcode Constants
	const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];
	const WASM_VERSION = [0x01, 0x00, 0x00, 0x00];

	const SECTION_TYPE = 1;
	const SECTION_IMPORT = 2;
	const SECTION_EXPORT = 7;

	const TYPE_I32 = 0x7f;
	const TYPE_FUNC = 0x60;

	// 1. Build the Type Section payload: (i32, i32, ...) -> i32
	// Generates an exact parameter map matching the requested arity footprint
	const typePayload = [
		0x01,                      // Number of types defined in this section
		TYPE_FUNC,                 // Form: Regular function type definition
		paramCount,                // Parameter count (e.g., 1 for dllEntry, or more for traps)
		...Array(paramCount).fill(TYPE_I32), // Fill parameter types as i32 scalars
		0x01,                      // Return count
		TYPE_I32                   // Return type: i32
	];

	// 2. Build the Import Section payload: Imports "env.f" matching Type Index 0
	const importPayload = [
		0x01,                      // Number of imports
		0x03, 0x65, 0x6e, 0x76,    // Module Name String: "env"
		0x01, 0x66,                // Field Name String: "f"
		0x00,                      // Kind: External Function
		0x00                       // Type Index mapped to Type Slot 0
	];

	// 3. Build the Export Section payload: Exports internal function 0 as "f"
	const exportPayload = [
		0x01,                      // Number of exports
		0x01, 0x66,                // Export Name String: "f"
		0x00,                      // Kind: External Function
		0x00                       // Function Index: 0 (The imported function)
	];

	// Helper function to format sections with standard LEB128 length headers
	function createSection(sectionId: number, payload: any[])
	{
		return [sectionId, ...encodeLEB128(payload.length), ...payload];
	}

	// Combine sections into a solid, structured byte sequence
	const totalModuleBytes = new Uint8Array([
		...WASM_MAGIC,
		...WASM_VERSION,
		...createSection(SECTION_TYPE, typePayload),
		...createSection(SECTION_IMPORT, importPayload),
		...createSection(SECTION_EXPORT, exportPayload)
	]);

	// Instantiate the custom binary sandbox container instantly on the main thread
	const transientModule = new WebAssembly.Module(totalModuleBytes);
	const transientInstance = new WebAssembly.Instance(transientModule, {
		env: { f: jsFunction }
	});

	// Extract the raw, certified WebAssembly execution handler
	return transientInstance.exports.f;
}

// Minimal LEB128 unsigned integer length packer utility
function encodeLEB128(value: number)
{
	const bytes: number[] = [];
	do
	{
		let byte = value & 0x7F;
		value >>= 7;
		if(value !== 0) byte |= 0x80;
		bytes.push(byte);
	} while(value !== 0);
	return bytes;
}

