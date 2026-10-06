
// @ts-check


/** @type {import('./components/bundle/worker.d').ServiceWorkerWindow & Worker & ServiceWorker} */
const serviceSelf = /** @type {any} */ (self);

if(!serviceSelf.api)
{
	serviceSelf.api = {
		github_token: null
	};
}

/** @type {Date | null} */
let localVersion = null;
let SHUTUP = true;

const originalConsole = {
	log: console.log,
	warn: console.warn,
	error: console.error,
	info: console.info
};


/**
 *
 * @param  {...any} args
 */
self.console.log = (...args) =>
{
	if(!SHUTUP && typeof originalConsole != 'undefined') originalConsole.log(...args);
};

/**
 *
 * @param  {...any} args
 */
self.console.warn = (...args) =>
{
	if(!SHUTUP && typeof originalConsole != 'undefined') originalConsole.warn(...args);
};

/**
 *
 * @param  {...any} args
 */
self.console.error = (...args) =>
{
	if(typeof originalConsole != 'undefined') originalConsole.error(...args);
};

/**
 *
 * @param  {...any} args
 */
self.console.info = (...args) =>
{
	if(!SHUTUP && typeof originalConsole != 'undefined') originalConsole.info(...args);
};

console.log('🔴 [SW-TRACE] Initial script execution block started.');

/**
 * Helper to load a script from IDB VFS and evaluate it in the worker context
 * @param {string} assetUrl
 */
async function importScriptFromVFS(assetUrl)
{
	assetUrl = assetUrl.replace(/^\/?assets\/|^\//ig, '');
	const localName = '/base' + (assetUrl.startsWith('/') ? '' : '/') + assetUrl;

	console.log(`💾 [SW-INIT] Attempting VFS database extraction for script: "${localName}"`);

	const fileRecord = await serviceSelf.getRecord?.(serviceSelf.DB_STORE_NAME ?? '', localName, serviceSelf.api?.environmentRepository);

	if(!fileRecord || !fileRecord.contents)
	{
		throw new Error(`Script "${localName}" not found in IndexedDB VFS.`);
	}

	if(fileRecord.contents instanceof ArrayBuffer || fileRecord.contents instanceof Uint8Array)
	{
		// Decode the Uint8Array binary array into a raw text string
		const decoder = new TextDecoder('utf-8');
		const scriptText = decoder.decode(fileRecord.contents);

		// Execute the script globally inside the Service Worker context
		// This accomplishes exactly what importScripts() does synchronously
		globalThis.eval(scriptText);
		console.log(`✨ [SW-INIT] Successfully evaluated script from VFS: "${localName}"`);
	}
}

// Orchestrator to attempt standard import, falling back to VFS if offline
async function initializeCoreScripts()
{
	const scriptsToLoad = [
		'/components/workers/local.js',
		'/file-manifest.js',
		'/components/workers/github.js',
	];

	for(const script of scriptsToLoad)
	{
		try
		{
			console.log(`🔗 [SW-TRACE] Attempting native script import: ${script}`);
			// Try standard synchronous network import first
			self.importScripts(script);
			console.log(`✅ [SW-TRACE] Imported natively: ${script}`);
		} catch(netError)
		{
			console.error(`⚠️ [SW-WARN] Native import failed for ${script}. Swapping to VFS fallback engine...`, netError);
			try
			{
				// Network failed (offline), extract out of IndexedDB VFS instead
				await importScriptFromVFS(script);
			} catch(vfsError)
			{
				console.error(`❌ [SW-CRITICAL] Total collapse. Failed to load ${script} from Network AND VFS:`, vfsError);
			}
		}
	}
}

// Execute the bootloader process
initializeCoreScripts();



const offlineAssetsInclude = [/\.dll$/, /\.pdb$/, /\.wasm/, /\.html/, /\.js$/, /\.json$/, /\.css$/, /\.woff$/, /\.png$/, /\.jpe?g$/, /\.gif$/, /\.ico$/, /\.blat$/, /\.dat$/, /\.webmanifest$/];
const offlineAssetsExclude = [/service-worker-assets\.js$|^service-worker/];

const ST_FILE = 8;
const ST_DIR = 4;
const FS_DEFAULT = (6 << 3) + (6 << 6) + (6);
const FS_FILE = (ST_FILE << 12) + FS_DEFAULT;
const FS_DIR = (ST_DIR << 12) + FS_DEFAULT;


// Global in-memory cache to prevent concurrent mkdirp race conditions
const createdDirectories = new Set();

/**
 *
 * @param {string} path
 * @param {string | undefined} selected
 */
async function mkdirp(path, selected)
{
	let segments = path.split(/\/|\\/gi).filter(Boolean);

	// Build the path layers sequentially
	for(let i = 1; i <= segments.length; i++)
	{
		const dir = '/' + segments.slice(0, i).join('/');

		// If this directory layer was already created in this lifecycle loop, skip it entirely!
		if(createdDirectories.has(dir))
		{
			continue;
		}

		const lastSlashIndex = dir.lastIndexOf('/');
		const parentDir = lastSlashIndex === 0 ? '/' : dir.substring(0, lastSlashIndex);

		console.log(`📂 [SW-FS] Safely writing isolated directory block: "${dir}"`);

		if(!(selected || serviceSelf.api?.environmentRepository) || !(selected ?? serviceSelf.api?.environmentRepository)?.split)
		{
			debugger;
			console.log('What the fuck is wrong with you brain?');
		}
		try
		{
			await serviceSelf.putRecord?.(serviceSelf.DB_STORE_NAME ?? '', {
				path: dir,
				timestamp: new Date(),
				mode: FS_DIR,
				parent: parentDir
			}, selected || serviceSelf.api?.environmentRepository);

			// Mark it as safely committed to avoid parallel thrashing
			createdDirectories.add(dir);
		} catch(dbErr)
		{
			console.error(`❌ [SW-DATABASE] mkdirp failed to store record for "${dir}":`, dbErr);
		}
	}
}

/**
 *
 * @param {Request | Response | void} response
 * @param {string | Uint8Array | ArrayBuffer | undefined} localCSP
 * @returns
 */
async function getHeaders(response, localCSP = void 0)
{
	const sha = localCSP ? await serviceSelf.getGitSha256Browser?.(localCSP) : undefined;
	const newHeaders = new Headers(response?.headers);
	newHeaders.set('X-Service-Worker-Handled', 'true');
	if(sha)
	{
		newHeaders.set('Content-Security-Policy', "script-src 'self' 'unsafe-eval' 'sha256-" + sha + "'; worker-src 'self' blob:;");
	} else
	{
		newHeaders.set('Content-Security-Policy', "script-src 'self' 'unsafe-eval' 'sha256-iN7wpJdxHlpujRppkOA8N0+Mzp0ZqZr3lCtxM00Y63c='; worker-src 'self' blob:;");
	}
	newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
	newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
	return newHeaders;
}

/**
 *
 * @param {string | undefined} selected
 */
async function checkDatabaseInstall(selected)
{
	if(!selected || !serviceSelf.DB_SCHEME)
	{
		return;
	}

	const databases = await serviceSelf.getDatabaseMetadata?.() ?? [];
	console.log('⚙️ [SW-INSTALL] Extracted internal IndexedDB metadata dictionaries:', databases);
	const shouldInstall = (await serviceSelf.needsInstall?.(selected, serviceSelf.DB_SCHEME))?.item3;
	if(databases.filter(d => d.key == selected).length == 0
		|| shouldInstall)
	{
		await serviceSelf.deleteOldDatabase?.(selected);
		await serviceSelf.setupDatabase?.(selected, serviceSelf.DB_SCHEME);
	}
}


/**
 *
 * @param {string | Request} urlInput
 * @param {string} key
 * @param {string | undefined} selected
 * @returns
 */
async function fetchAsset(urlInput, key, selected)
{
	selected ||= serviceSelf.api?.environmentRepository;

	if(!urlInput)
	{
		debugger;
		console.error('HOW DID YOU FUCK THIS UP?');
		throw new Error('HOW DID YOU FUCK THIS UP?');
	}

	// Extract the string URL immediately, regardless of what was passed in
	const urlString = typeof urlInput === 'string' ? urlInput : urlInput.url;

	console.log(`🌐 [SW-NET] fetchAsset initiated. URL: "${urlString}" | Internal Key: "${key}"`);
	const timeoutSignal = AbortSignal.timeout(10000);
	let response;

	try
	{
		if(typeof urlInput === 'string')
		{
			console.log(`🌐 [SW-NET] Launching string-type fetch request. Cache: no-store for URL: "${urlString}"`);
			response = await fetch(urlInput, {
				cache: 'no-store',
				credentials: 'omit',
				signal: timeoutSignal
			});
		} else
		{
			console.log(`🌐 [SW-NET] Launching direct Request object pass-through fetch for URL: "${urlString}"`);
			// If passing a Request object, clone it if it's going to be reused or has a body
			response = await fetch(urlInput);
		}

		console.log(`🌐 [SW-NET] Fetch response received for "${key}". Status: ${response.status} (${response.statusText}) | Type: ${response.type}`);

		if(response.redirected || response.type === 'opaqueredirect')
		{
			// FIXED: Using the guaranteed string variable here
			if(!urlString.includes('index.html'))
			{
				console.warn(`⚠️ [SW-WARN] Asset file was intercepted by a REDIRECT payload: ${urlString} -> Target: ${response.url}`);
			}
			const newHeaders = await getHeaders(response);
			newHeaders.set('Location', response.url);

			console.log(`🔄 [SW-NET] Fabricating 302 redirection response bridge for "${key}"`);
			isOffline = false;

			return new Response(null, {
				status: 302,
				statusText: response.statusText,
				//url: response.url,
				headers: newHeaders
			});
		}

		if(!response.ok && response.type !== 'opaque')
		{
			console.error(`❌ [SW-NET] Response evaluation failed validation checks for "${key}". Status code is bad.`);
			throw new Error(`Request for ${key} failed with status: ${response.status}`);
		}

		console.log(`📦 [SW-BUFFER] Cloning fetch response body stream safely to avoid consumption locks for "${key}"`);
		let content = await response.clone().arrayBuffer();
		console.log(`📦 [SW-BUFFER] ArrayBuffer extraction complete for "${key}". Length: ${content.byteLength} bytes.`);

		key = key.replace(/^\/?base\/|^\/?assets\/|^\//ig, '');
		let localKey = '/base' + (key.startsWith('/') ? '' : '/') + key;
		let dirPath = localKey.substring(0, localKey.lastIndexOf('/'));

		console.log(`📂 [SW-FS] Staging VFS mapping coordinates. localKey: "${localKey}" | dirPath: "${dirPath}"`);

		await mkdirp(dirPath, selected);

		console.log(`💾 [SW-DATABASE] Writing payload binary content into IndexedDB Store: "${serviceSelf.DB_STORE_NAME}" -> Target Key: "${localKey}"`);


		const isGithubContents = urlString.includes('api.github.com') && urlString.match(/contents\/|\/contents($|[\?])/ig);

		// OFFLINE BULLSHIT
		if(isGithubContents)
		{
			try
			{
				// 1. Create a URL object to cleanly strip query string tokens safely
				const parsedUrl = new URL(urlString);

				// 2. Locate the index where the contents slice breaks off
				const contentsMarker = '/contents/';
				const markerIndex = parsedUrl.pathname.indexOf(contentsMarker);

				let isDirectory = false;
				let fileContent;
				try
				{
					const jsonResponse = JSON.parse(new TextDecoder().decode(content));
					if(jsonResponse.encoding === 'base64')
					{
						const binString = atob(jsonResponse.content.replace(/\s/g, ''));
						fileContent = Uint8Array.from(binString, c => c.charCodeAt(0));
					} else if(jsonResponse.size > 0)
					{
						fileContent = new TextEncoder().encode(jsonResponse.content || "");
					} else if(jsonResponse instanceof Array)
					{
						isDirectory = true;
						fileContent = new TextEncoder().encode(JSON.stringify(jsonResponse));
					}
				} catch(e)
				{
					if(e instanceof Error)
					{
						console.warn('Could not extract file contents: ' + e.message + '\n' + (e.stack));
					}
				}

				if(markerIndex !== -1 && fileContent && selected && serviceSelf.DB_SCHEME)
				{
					// Extract everything following '/contents/'
					// e.g., "/repos/owner/repo/contents/scripts/base.shader" -> "scripts/base.shader"
					let repoRelativePath = parsedUrl.pathname.substring(markerIndex + contentsMarker.length);

					// Normalize leading slashes so keys are uniform across variants
					repoRelativePath = '/' + repoRelativePath.replace(/^\//, '');

					await checkDatabaseInstall(selected);

					// 3. Write it into your target database matching the exact repository architecture
					await serviceSelf.putRecord?.(serviceSelf.DB_STORE_NAME ?? '', {
						path: repoRelativePath,
						timestamp: new Date(),
						mode: isDirectory ? FS_DIR : FS_FILE,
						contents: fileContent,
						parent: repoRelativePath.substring(0, repoRelativePath.lastIndexOf('/')) || '/'
					}, selected);

					console.log(`✅ [SW-DATABASE] GitHub Contents asset mapped to repo root -> Wrote "${repoRelativePath}" to storage block.`);
				}
			} catch(parseErr)
			{
				console.error(`❌ [SW-DATABASE] Failed to extract repo root path mapping from URL: ${urlString}`, parseErr);
			}
		} else
		{

			if(localKey.includes('contents'))
			{
				console.error('yOU cAn\'T ProGrAm FoR SHIT');
				debugger;
			}
			if(!localKey.includes('.'))
			{
				debugger;
				console.error("WHAT THE FUCK IS WRONG WITH YOU? " + key);
			}

			await checkDatabaseInstall(selected);

			// Standard baseline VFS handling for local framework queries
			await serviceSelf.putRecord?.(serviceSelf.DB_STORE_NAME ?? '', {
				path: localKey,
				timestamp: new Date(),
				mode: FS_FILE,
				contents: new Uint8Array(content),
				parent: dirPath
			}, selected);
			console.log(`✅ [SW-DATABASE] Successfully wrote "${localKey}" to local storage block.`);
		}

		isOffline = false;

		return new Response(content, {
			status: response.status,
			statusText: response.statusText,
			headers: await getHeaders(response)
		});

	} catch(err)
	{
		console.error(`❌ [SW-CATCH] Exception intercepted inside fetchAsset for "${key}":`, err);

		if(!navigator.onLine || err instanceof TypeError)
		{
			console.warn(`⚠️ [SW-STATUS] Network state evaluated as OFFLINE. Flagging environment status state.`);
			isOffline = true;
		}

		if(err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'))
		{
			console.error(`⏱️ [SW-TIMEOUT] Asset fetching operation timed out (>10000ms threshold) for: "${key}"`);
		}

		console.log(`🔺 [SW-CATCH] Re-throwing error to maintain execution bubble guarantees.`);
		throw err;
	}
}


let assetLookup = null;
let assetsInstalling = 10;
let assetsInstalled = 0;
let assetsFailed = 0;
let assetsStart = new Date();
let previousAsset = '';
/** @type {boolean | Promise<void>} */
let installing = false;
/**
 *
 * @returns {Promise<void>}
 */
async function installAssets()
{
	console.log('⚙️ [SW-INSTALL] Executing asset installer verification.');

	if(installing instanceof Promise)
	{
		return await installing;
	}

	if(!serviceSelf.api?.environmentRepository)
	{
		debugger;
		throw new Error('Learn how to code fucking dumbass.');
	}

	try
	{
		const databases = await serviceSelf.getDatabaseMetadata?.() ?? [];
		console.log('⚙️ [SW-INSTALL] Extracted internal IndexedDB metadata dictionaries:', databases);
		const shouldInstall = (await serviceSelf.needsInstall?.(serviceSelf.api.environmentRepository, serviceSelf.DB_SCHEME ?? []))?.item3;
		if(databases.filter(d => d.key == serviceSelf.api?.environmentRepository).length == 0
			|| shouldInstall)
		{
			console.warn(`⚠️ [SW-DATABASE] Target database "${serviceSelf.api.environmentRepository}" missing. Initializing core database maps now.`);
			await serviceSelf.deleteOldDatabase?.(serviceSelf.api.environmentRepository);
			await serviceSelf.setupDatabase?.(serviceSelf.api.environmentRepository, serviceSelf.DB_SCHEME ?? []);
			console.log(`✅ [SW-DATABASE] Target database infrastructure initialized cleanly.`);
		}
	} catch(dbSetupErr)
	{
		console.error('❌ [SW-DATABASE] Database lookup/instantiation failure loop caught:', dbSetupErr);
	}

	console.log(`⚙️ [SW-INSTALL] Deduplication complete. Found ${uniqueAssets.length} total base assets to evaluate.`);

	const assets = uniqueAssets
		.filter(asset =>
		{
			const isIncluded = offlineAssetsInclude.some(pattern => pattern.test(asset));
			if(!isIncluded) console.log(`🗑️ [SW-FILTER] Asset excluded (failed inclusion whitelist match): "${asset}"`);
			return isIncluded;
		})
		.filter(asset =>
		{
			const isExcluded = offlineAssetsExclude.some(pattern => pattern.test(asset));
			if(isExcluded) console.log(`🚫 [SW-FILTER] Asset excluded (hit explicit blacklist regex): "${asset}"`);
			return !isExcluded;
		});

	console.log(`⚙️ [SW-INSTALL] Filtering finalized. ${assets.length} out of ${uniqueAssets.length} assets queued for download.`);

	assetsStart = new Date;
	assetsInstalled = 0;
	assetsFailed = 0;
	assetsInstalling = assets.length;
	const batchSize = 10;
	for(let i = 0; i < assets.length; i += batchSize)
	{
		const chunk = assets.slice(i, i + batchSize);

		const chunkResults = await Promise.all(chunk.map(async asset =>
		{
			asset = asset.replace(/^\/?assets\//ig, '');
			let localName = '/base' + (asset.startsWith('/') ? '' : '/') + asset;
			if(!localName.includes('.'))
			{
				debugger;
				console.error("WHAT THE FUCK IS WRONG WITH YOU? " + localName);
			}
			console.log(`🔍 [SW-CACHE-CHECK] Checking if asset exists inside IndexedDB cache: "${localName}"`);

			try
			{
				const files = await serviceSelf.getRecord?.(serviceSelf.DB_STORE_NAME ?? '', localName, serviceSelf.api?.environmentRepository);
				if(files && files.contents)
				{
					console.log(`✨ [SW-CACHE-HIT] Asset already mapped locally inside DB. Skipping download for: "${localName}"`);
					previousAsset = localName;
					assetsInstalled++;
					reportProgress();
					return;
				}
			} catch(e)
			{
				console.error(`❌ [SW-DATABASE] Failed to execute cache validation lookup for "${localName}":`, e);
			}

			try
			{
				console.log(`📥 [SW-INSTALL] Cache miss or empty binary payload. Triggering download request routing for: "${asset}"`);
				return await fetchAsset(asset, localName, serviceSelf.api?.environmentRepository).then(() =>
				{
					previousAsset = localName;
					assetsInstalled++;
					reportProgress();
				}).catch(e =>
				{
					console.error(`❌ [SW-INSTALL] Target download execution block failed for asset "${asset}":`, e);
					console.warn("Offline asset failed: " + asset);
					previousAsset = localName;
					assetsFailed++;
					reportProgress();
				});
			} catch(e)
			{
				console.error(`❌ [SW-INSTALL] Synchronous catch block hit for download processor pipeline for "${asset}":`, e);
				console.warn("Offline asset failed: " + asset);
				previousAsset = localName;
				assetsFailed++;
				reportProgress();
			}
		}));

	}

	installing = false;
}

/** @type {Record<number, MessagePort>} */
const waitingPorts = {};
function reportProgress()
{
	const percent = assetsInstalling > 0
		? Math.min(100, Math.round(((assetsInstalled + assetsFailed) / assetsInstalling) * 100))
		: 0;
	const payload = {
		type: 'PROGRESS',
		loaded: assetsInstalled,
		total: assetsInstalling,
		failed: assetsFailed,
		previous: previousAsset,
		percent
	};
	// TODO:
	//originalConsole.warn('Progress', waitingPorts, payload);

	for(const key of Object.keys(waitingPorts))
	{
		/** @type {number} */
		const time = typeof key === 'number' ? key : parseInt(key);
		if(time < assetsStart.getTime() - 30)
		{
			delete waitingPorts[time];
			continue;
		}

		/** @type {MessagePort} */
		const port = waitingPorts[time];
		port.postMessage(payload);
	}
}



serviceSelf.addEventListener('install', (event) =>
{
	console.info('🚀 [SW-LIFECYCLE] --- INSTALL EVENT TRIGGERED ---');

	event.waitUntil((async () =>
	{
		if(!localVersion || !serviceSelf.api?.environmentRepository)
		{
			alreadyVersioning = lookupLocalVersion('install');
			await alreadyVersioning;
		}

		console.log('🚀 [SW-LIFECYCLE] Install waitUntil execution promise chain starting.');
		try
		{
			installing = installAssets();
			console.log('🚀 [SW-LIFECYCLE] installAssets layout execution loop completed successfully.');
		} catch(installErr)
		{
			console.error('❌ [SW-CRITICAL] Asset pre-installation chain failed to complete:', installErr);
		}

		console.log('🚀 [SW-LIFECYCLE] Executing serviceSelf.skipWaiting() to destroy active zombie worker layers.');
		serviceSelf.skipWaiting();
	})());
});


function ensureInitialized()
{
	if(!swInitializationPromise)
	{
		swInitializationPromise = (async () =>
		{
			if(!localVersion || !serviceSelf.api?.environmentRepository)
			{
				alreadyVersioning = lookupLocalVersion('init');
				await alreadyVersioning;
			}
		})();
	}
	return swInitializationPromise;
}

serviceSelf.addEventListener('activate', event =>
{
	console.info('🚀 [SW-LIFECYCLE] --- ACTIVATE EVENT TRIGGERED ---');
	event.waitUntil((async () =>
	{
		// Force the configuration initialization loop immediately
		await ensureInitialized();

		console.log(`🚀 [SW-LIFECYCLE] Closing database instance "${serviceSelf.api?.environmentRepository}" for clean boot state reset.`);
		try
		{
			console.log('⚙️ [SW-ASYNC] Running scheduled installAssets post-activation validation routine.');
			installing = installAssets();
		} catch(err)
		{
			console.error('❌ [SW-CRITICAL] Failure encountered during core activation block:', err);
		}
		return serviceSelf.clients.claim();
	})());
});

// Global state for the singleton worker
let lastConnectivityCheck = 0;
let isOffline = false;
let connectivityLog = [];


// Wrapping execution in a function context to track the state safely
(async function inspectRegistrationState()
{
	console.log('🔍 [SW-BOOT-CHECK] Inspecting active background service worker registration objects...');
	// Small delay to ensure registration mapping bindings are fully parsed by the runtime
	await new Promise(r => setTimeout(r, 0));

	if(serviceSelf.registration && serviceSelf.registration.active != null)
	{
		const scriptUrl = serviceSelf.registration.active.scriptURL;
		console.log('🔍 [SW-BOOT-CHECK] Active Worker Registration detected. Metadata details payload:', serviceSelf.registration.active);
		console.log(`🔍 [SW-BOOT-CHECK] Script target parsing URL mapping string: "${scriptUrl}"`);

		try
		{
			const url = new URL(scriptUrl);
			const timestampStr = url.searchParams.get('t');
			if(timestampStr)
			{
				localVersion = new Date(parseInt(timestampStr, 10));
				console.log(`⏳ [SW-BOOT-CHECK] Decoded local timestamp version mapping from script URL parameters: ${localVersion.toISOString()}`);
			} else
			{
				console.log('🔍 [SW-BOOT-CHECK] No search parameter timestamp version string matches found ("?t=" missing).');
			}
		} catch(urlErr)
		{
			console.error('❌ [SW-BOOT-CHECK] URL parsing engine choked on parsing script URL components:', urlErr);
		}
	} else
	{
		console.log('🔍 [SW-BOOT-CHECK] serviceSelf.registration.active is currently NULL or evaluating as empty.');
	}
})();

let needsRefresh = false;
/** @type {Promise<void> | null} */
let swInitializationPromise = null;

async function checkStatus()
{
	// 1. Core Lifecycle Lock: Ensure the asynchronous database lookup passes
	// COMPLETELY exactly once before any downstream logic or fetch queries execute
	if(!swInitializationPromise)
	{
		swInitializationPromise = (async () =>
		{
			if(!localVersion || !serviceSelf.api?.environmentRepository)
			{
				alreadyVersioning = lookupLocalVersion('status');
				await alreadyVersioning;
			}
		})().catch(err =>
		{
			swInitializationPromise = null; // Flush on failure to allow subsequent asset fetches to retry
			throw err;
		});
	}
	await swInitializationPromise;

	// 2. Offline Connectivity Checks
	if(!navigator.onLine)
	{
		console.log(`⏱️ [SW-HEARTBEAT] Browser context reports completely OFFLINE. Aborting live API updates check.`);
		isOffline = true;
		return;
	}

	// 3. Heartbeat Throttling
	const now = Date.now();
	if(now - lastConnectivityCheck < 10000)
	{
		console.log(`⏱️ [SW-HEARTBEAT] Suppressing status execution check. Last check occurred less than 10000ms ago.`);
		return; // Safe to return because swInitializationPromise is fully resolved here
	}
	lastConnectivityCheck = now;
	console.log('⏱️ [SW-HEARTBEAT] Executing connectivity status/version analysis check rules...');

	// 4. Remote Repository Comparison Check Sequence
	try
	{
		const parts = serviceSelf.api?.environmentRepository?.split('/');
		const ownerName = parts?.[0];
		const repoName = parts?.[1];

		console.log(`🌐 [SW-HEARTBEAT] Routing target parsing parameters -> Owner: "${ownerName}" | Repo: "${repoName}"`);

		const branch = ownerName && repoName ? await serviceSelf.getDefaultBranch?.(ownerName, repoName) : void 0;
		console.log(`🌐 [SW-HEARTBEAT] Resolved Remote Repo target branch checkpoint identifier: "${branch}"`);

		const latestFileTime = ownerName && repoName ? await serviceSelf.getBranchVersion?.(ownerName, repoName, branch) : void 0;
		console.log(`🌐 [SW-HEARTBEAT] Timestamps comparison values -> Local: ${localVersion ? new Date(localVersion).toISOString() : 'NULL'} | Remote GitHub Branch: ${latestFileTime ? new Date(latestFileTime).toISOString() : 'NULL'}`);

		if(latestFileTime && localVersion && latestFileTime > localVersion)
		{
			console.warn('⚠️ [SW-OUT-OF-SYNC] Remote version changes detected on repository root branch! Initiating destructive workspace purge sequence.');

			originalConsole.log(`🗑️ [SW-PURGE] Dropping local IndexedDB database blocks: "${serviceSelf.api?.environmentRepository}"`);
			await serviceSelf.deleteOldDatabase?.(serviceSelf.api?.environmentRepository);
			console.log(`🗑️ [SW-PURGE] Database wipe finished.`);

			console.warn('🚀 [SW-LIFECYCLE] Executing serviceSelf.registration.unregister() to purge active browser cache handlers...');
			await serviceSelf.registration.unregister();
			console.log('🚀 [SW-LIFECYCLE] Service Worker deregistration completed successfully.');

			needsRefresh = true;
		} else
		{
			console.log('✨ [SW-HEARTBEAT] Version signature hashes verified as matching or local cache layer is fresh.');
		}

		isOffline = false;

	} catch(err)
	{
		console.warn('⚠️ [SW-HEARTBEAT] Connectivity or Version pipeline verification request check collapsed:', err);
		if(!navigator.onLine || err instanceof TypeError)
		{
			originalConsole.warn('⚠️ [SW-STATUS] Network connection drop discovered via physical interface check flags.');
			isOffline = true;
		}
	}
}


/**
 * @type {Promise<void> | undefined}
 */
let alreadyVersioning;

/**
 *
 * @param {string | undefined} source
 */
async function lookupLocalVersion(source)
{
	if(alreadyVersioning)
	{
		originalConsole.log(`🔍 [SW-MESSAGE] Already versioning...`, source);
		return alreadyVersioning;
	} else
	{
		originalConsole.log(`🔍 [SW-MESSAGE] Looking up version...`, source);
		if(source === 'client')
		{
			//debugger;
		}
	}

	try
	{

		const databases = await serviceSelf.getDatabaseMetadata?.();

		/** @type {import('./components/bundle/local.d').FileRecord | null} */
		let newestVersionFile = null;
		let chosenRepo = serviceSelf.api?.environmentRepository;

		// 1. Concurrently query all databases for the settings file
		const lookups = databases?.map(async (db) =>
		{
			try
			{
				// Assuming getRecord takes a database identifier or repository reference as the 3rd argument
				const versionFile = await serviceSelf.getRecord?.(serviceSelf.DB_STORE_NAME ?? '', '/base/settings.json', db.key);
				return { versionFile, repo: db.key };
			} catch(e)
			{
				// Silently ignore individual database failures so one broken DB doesn't crash the loop
				return null;
			}
		});

		const results = await Promise.all(lookups ?? []);

		// 2. Loop through the results to find the most recent copy based on timestamp
		for(const result of results)
		{
			if(!result || !result.versionFile || !result.versionFile.timestamp) continue;

			if(!newestVersionFile || (newestVersionFile?.timestamp && result.versionFile.timestamp > newestVersionFile.timestamp))
			{
				newestVersionFile = result.versionFile;
				chosenRepo = result.repo ?? serviceSelf.DB_NAME ?? 'bjcullinan2/gameserver-ts';
			}
		}

		// 3. Process the newest file found (if any)
		if(newestVersionFile && (newestVersionFile.contents instanceof ArrayBuffer || newestVersionFile.contents instanceof Uint8Array))
		{
			try
			{
				const settings = JSON.parse(new TextDecoder().decode(newestVersionFile.contents));
				localVersion = settings.environment_version;
				if(serviceSelf.api)
				{
					serviceSelf.api.environmentRepository = settings.environment_repository || chosenRepo;
					serviceSelf.api.github_token = settings.github_token;
				}
				originalConsole.log(`✅ [SW-MESSAGE] Version lookup succeeded, found: ${localVersion}`, source);
			} catch(e)
			{
				originalConsole.log(`⚠️ [SW-MESSAGE] Version lookup failed, using fallback: ${localVersion}`, source);
				originalConsole.error(e);
				localVersion ||= newestVersionFile.timestamp || null;
				if(serviceSelf.api)
				{
					serviceSelf.api.environmentRepository = chosenRepo;
				}
			}
		} else
		{
			originalConsole.log(`⚠️ [SW-MESSAGE] No version file found across any databases. Fallback: ${localVersion}`);
		}
		if(!serviceSelf.api?.environmentRepository)
		{
			debugger;
			originalConsole.log('You\'re a fucking idiot.');
		}
	} finally
	{
		alreadyVersioning = undefined;
	}
}


serviceSelf.addEventListener('message', async (event) =>
{
	console.log('✉️ [SW-MESSAGE] Incoming communication frame received inside message event listener.', event.data);

	if(event.data && event.data.type === 'DEREGISTER')
	{
		console.warn('✉️ [SW-MESSAGE] Command route identified: DEREGISTER intercept request processed.');

		await serviceSelf.registration.unregister();
		needsRefresh = true;

		if(event.ports && event.ports[0])
		{
			console.log('✉️ [SW-MESSAGE] Sending confirmation payload reply back through requested transmission channel message port.');
			event.ports[0].postMessage({
				type: 'DEREGISTERED',
				version: localVersion
			});
		}
	}
	else if(event.data && event.data.type === 'GET_VERSION')
	{
		originalConsole.log('✉️ [SW-MESSAGE] Command route identified: GET_VERSION parameter data report request.');
		SHUTUP = !!event.data.shutup;

		//if(!localVersion || !api.environmentRepository)
		try
		{
			alreadyVersioning = lookupLocalVersion('client');
			await alreadyVersioning;
		} catch(e)
		{
			originalConsole.error(e);
		}

		if(event.ports && event.ports[0])
		{
			originalConsole.log(`✉️ [SW-MESSAGE] Dispatching configuration report data frame. Version string: ${localVersion}`);
			for(const port of event.ports)
			{
				waitingPorts[Date.now()] = port;
			}
			reportProgress();
			for(const port of event.ports)
			{
				port.postMessage({
					type: 'VERSION_REPORT',
					version: localVersion
				});
			}
		} else
		{
			//originalConsole.log(`❌ [SW-MESSAGE] Not responding to ports: ${localVersion}`);
		}

		originalConsole.log('✉️ [SW-MESSAGE] Queueing secondary checkStatus validation task routine...');
		checkStatus();
	} else if(event.data && event.data.type === 'CLAIM_CLIENTS')
	{
		serviceSelf.clients.claim();
		if(event.ports && event.ports[0])
		{
			waitingPorts[Date.now()] = event.ports[0];
			reportProgress();
		}
	}
});

let ignoreUrlParametersMatching = [/^utm_|^t=/];

/**
 *
 * @param {string} originalUrl
 * @param {RegExp[]} ignoreUrlParametersMatching
 * @returns
 */
function stripIgnoredUrlParameters(originalUrl, ignoreUrlParametersMatching)
{
	let url = new URL(originalUrl);
	url.hash = '';

	console.log(`🔗 [SW-URL-STRIP] Raw query parsing calculation executing for string: "${originalUrl}"`);

	url.search = url.search.slice(1)
		.split('&')
		.map(function (kv)
		{
			return kv.split('=');
		})
		.filter(function (kv)
		{
			return ignoreUrlParametersMatching.every(function (ignoredRegex)
			{
				const matchFound = ignoredRegex.test(kv[0]);
				if(matchFound) console.log(`🔗 [SW-URL-STRIP] Truncating parameter match from route payload: "${kv[0]}"`);
				return !matchFound;
			});
		})
		.map(function (kv)
		{
			return kv.join('=');
		})
		.join('&');

	const cleanResult = url.pathname.replace(/^\//ig, '') + url.search;
	console.log(`🔗 [SW-URL-STRIP] URL normalization output completed. Clean internal routing path: "${cleanResult}"`);
	return cleanResult;
};

async function manufactureRefreshResponse()
{
	console.log('🧱 [SW-HTML-FACTORY] Constructing virtual execution sandbox refresh document bridge...');
	const html = `
    <!DOCTYPE html>
    <html>
        <head><title>Updating...</title></head>
        <body>
            <script>
                console.log("🔄 [CLIENT-SIDE] Executing absolute location replacement reload script from SW virtual payload.");
                window.location = '/' + window.location.pathname + "?t=" + Date.now();
            </script>
        </body>
    </html>
`;

	const newHeaders = await getHeaders();
	newHeaders.set('Content-Type', 'text/html');
	return new Response(html, {
		headers: newHeaders
	});
}



console.log('⚙️ [SW-INSTALL] Compiling module path strings from global IMPORT arrays...');
const uniqueAssets = serviceSelf.__assetsManifest?.map(ass => ass.path.replace(/^\/?assets\/|^\//ig, '')) ?? []; // Normalize paths to omit leading slashes\




serviceSelf.addEventListener('fetch', (event) =>
{
	if(event.request.method !== 'GET') return;

	const isAssetQuery = event.request.url.includes('/components/') || event.request.url.includes('/ace/');

	if(!isOffline && event.request.url.includes('version.json'))
	{
		return;
	}

	const localCSP = event.request.url.includes('local-csp=');
	const requestUrlObj = new URL(event.request.url);
	const relativePath = requestUrlObj.pathname.replace(/^\//, '');

	const isNavigation = event.request.mode === 'navigate';
	let assetUrl = null;
	let isGithubContents = false;
	let fallbackSelected = null; // Track route-specific overrides (like explicit github queries)

	// Evaluate VFS matching rules
	if(uniqueAssets.includes(relativePath) || isAssetQuery)
	{
		assetUrl = relativePath;
	} else if(isNavigation)
	{
		assetUrl = 'index.html';
	} else if(requestUrlObj.hostname === 'api.github.com')
	{
		const gitHubMatch = requestUrlObj.pathname.match(/^\/repos\/([^\/]+)\/([^\/]+)\/?(.*)$/i);
		if(gitHubMatch)
		{
			const [_, owner, repo, restOfRoute] = gitHubMatch;
			fallbackSelected = `${owner}/${repo}`; // Route override context

			isGithubContents = restOfRoute.startsWith('contents/');

			if(isGithubContents)
			{
				// This preserves "contents/maps/q3dm7.bsp" so the network request pulls the real file
				assetUrl = restOfRoute;
			} else
			{
				// Baseline behavior for standard repo metadata API calls (like branches, commits etc.)
				const routeKey = restOfRoute || 'index';
				const escapedRoute = routeKey.replace(/[^a-z0-9]/gi, '-').toLowerCase();
				assetUrl = `${escapedRoute}.json`;
			}
		}
	}

	if(!assetUrl) return;

	assetUrl = assetUrl.replace(/^\/?assets\/|^\/|^\/?base\//ig, '');

	let localName;
	if(isGithubContents)
	{
		// Strip '/contents/' or 'contents/' prefix for local database lookups
		let cleanPath = assetUrl.replace(/^contents\//i, '');
		localName = '/' + cleanPath.replace(/^\//, '');
	} else
	{
		localName = '/base' + (assetUrl.startsWith('/') ? '' : '/') + assetUrl;
	}

	const contentType = getMimeType(assetUrl);

	event.respondWith((async () =>
	{
		// --- FIX A: FORCE STATUS AND INITIALIZATION UNTIL COMPLETION ---
		await checkStatus();

		// --- FIX B: EVALUATE STATE ONLY AFTER THE LOCK RELEASES ---
		let selected = fallbackSelected || serviceSelf.api?.environmentRepository;

		if(!selected && !localCSP)
		{
			console.error(`🚨 [SW-FETCH-FATAL] Repository context still empty for asset: "${assetUrl}"`);
			return fetch(event.request);
		}

		// 2. Network Check First Strategy
		if(!isOffline && !localCSP)
		{
			try
			{
				const response = await fetchAsset(event.request, assetUrl, selected);
				if(response.ok) return response;
			} catch(netErr)
			{
				console.error(`⚠️ [SW-FETCH-NET] Failure for "${assetUrl}":`, netErr);
			}
		}

		// 3. Fallback: Local VFS DB retrieval
		try
		{
			const files = await serviceSelf.getRecord?.(serviceSelf.DB_STORE_NAME ?? '', localName, selected);
			if(files && files.contents)
			{
				/** @type {ArrayBuffer | undefined} */
				let content;

				if(files.contents instanceof FileSystemFileHandle)
				{
					const file = await files.contents.getFile();
					content = await file.arrayBuffer();
				} else if(files.contents instanceof ArrayBuffer)
				{
					content = files.contents;
				} else if(files.contents instanceof Uint8Array)
				{
					// Copy bytes to guarantee a standalone, non-shared ArrayBuffer
					const copy = new Uint8Array(files.contents.byteLength);
					copy.set(files.contents);
					content = /** @type {ArrayBuffer} */ (copy.buffer);
				}

				if(!content)
				{
					throw new Error('File could not be loaded: ' + files.path);
				}

				const newHeaders = assetUrl === 'index.html'
					? await getHeaders()
					: await getHeaders(undefined, content);

				newHeaders.set('Content-Type', contentType);

				// Cast explicitly to BodyInit to satisfy strict TS Response constructor types
				return new Response(/** @type {BodyInit} */(content), {
					status: 200,
					statusText: 'OK',
					headers: newHeaders
				});
			}
		} catch(dbReadErr)
		{
			console.error(`❌ [SW-FETCH-STORE] DB Crash for key "${localName}":`, dbReadErr);
		}

		return fetch(event.request);
	})());
});



/**
 *
 * @param {string} url
 * @returns
 */
function getMimeType(url)
{
	if(url.endsWith('.wasm')) return 'application/wasm';
	if(url.endsWith('.js')) return 'application/javascript; charset=utf-8';
	if(url.endsWith('.mjs')) return 'application/javascript; charset=utf-8';
	if(url.endsWith('.json')) return 'application/json; charset=utf-8';
	if(url.endsWith('.html')) return 'text/html; charset=utf-8';
	if(url.endsWith('.css')) return 'text/css; charset=utf-8';
	if(url.endsWith('.ttf')) return 'font/ttf';
	if(url.endsWith('.woff')) return 'font/woff';
	if(url.endsWith('.woff2')) return 'font/woff2';
	return 'application/octet-stream';
}

console.log('🔴 [SW-TRACE] Script evaluation complete. Listeners successfully bound to background process threads.');
