

// @ts-check

/** @type {import('../bundle/github.d').GithubWindow & import('../bundle/local.d').LocalWindow & import('../bundle/menu.d').GlobalToolbarsWindow & import('../bundle/make.d').BuildWindow} */
const localSelf = /** @type {any} */ (self);


const DB_VERSION = 1; // Increment this when you add new C# Entities!
const DB_NAME = "briancullinan2/gameserver-ts";
localSelf.DB_NAME = DB_NAME;
const DB_STORE_NAME = 'FILE_DATA';
localSelf.DB_STORE_NAME = DB_STORE_NAME;
const DB_DEBOUNCE_INTERVAL = 50;

const DB_SCHEME = [
	{
		key: DB_STORE_NAME, value: {
			item1: 'path', item2: [{
				key: 'timestamp', value: 'timestamp'
			}, {
				key: 'parent', value: 'parent'
			}]
		}
	}
];

localSelf.DB_SCHEME = DB_SCHEME;

/**
 *
 * @param {string | null} dbName
 * @param {number | boolean | null} dbVersion
 * @returns
 */
async function getDB(dbName = null, dbVersion = null)
{
	return new Promise((rs, rj) =>
	{
		const req = indexedDB.open(dbName || DB_NAME, dbVersion === false ? undefined : (typeof dbVersion === 'number' ? dbVersion : DB_VERSION));
		req.onsuccess = () => rs(req.result);
		req.onerror = () =>
		{
			console.error(req.error);
			return rj(req.error);
		};
		// Note: setupStore handles the onupgradeneeded logic
		return [dbName || DB_NAME, dbVersion || DB_VERSION];
	});
}

localSelf.getDB = getDB;

/**
 * @param {string | null} [dbName=null]
 */
async function deleteOldDatabase(dbName = null)
{
	return new Promise((rs) =>
	{
		const req = indexedDB.deleteDatabase(dbName || DB_NAME);
		req.onsuccess = () => rs(true);
		req.onerror = () => rs(false); // Silent fail is usually fine for cleanup
		req.onblocked = () => rs(true);
	});
}


localSelf.deleteOldDatabase = deleteOldDatabase;


async function getDatabaseMetadata()
{
	// Returns a list of { name, version } objects
	// Note: this may not be supported in very old WebViews,
	// but works in modern MAUI (Edge/WebView2/WebKit)
	if(!indexedDB.databases)
	{
		return [];
	}
	const dbs = await indexedDB.databases();
	// DO NOT skip the offline database
	return dbs //.filter(db => db.name != DB_NAME)
		.map(db => ({ key: db.name || '', value: db.version || 0 }));
}

localSelf.getDatabaseMetadata = getDatabaseMetadata;

/**
 *
 * @param {string | null} dbName
 * @param {import('../bundle/local.d').SchemaStoreConfig[]} expectedStores
 * @returns
 */
async function needsInstall(dbName, expectedStores)
{
	return new Promise((resolve) =>
	{
		const request = indexedDB.open(dbName || DB_NAME);

		request.onsuccess = (event) =>
		{
			const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
			const existingStores = Array.from(db.objectStoreNames);

			// Identify which expected stores are missing
			const missingStores = expectedStores.filter(s => !existingStores.includes(s.key)).map(s => s.key);

			db.close();
			return resolve({
				item1: dbName,
				item2: db.version,
				item3: missingStores.length > 0,
				item4: missingStores
			});
		};

		request.onerror = () =>
		{
			// If we can't even open it, mark as corrupted
			console.error(request.error);
			return resolve({ item1: dbName || DB_NAME, item2: DB_VERSION, item3: true, item4: expectedStores.map(s => s.key) });
		};
	});
}

localSelf.needsInstall = needsInstall;

/**
 *
 * @param {string | null} dbName
 * @param {import('../bundle/local.d').SchemaStoreConfig[]} stores
 * @returns
 */
async function setupDatabase(dbName, stores)
{
	let created = false;
	/** @type {string | null} */
	let error = null;
	if(!dbName || dbName.length < 4 || dbName.startsWith('/'))
	{
		debugger;
		console.error('how the fuck does this even happen?');
		throw new Error('how the fuck does this even happen?');
	}
	return new Promise((rs, rj) =>
	{
		const request = indexedDB.open(dbName || DB_NAME, DB_VERSION);

		request.onupgradeneeded = (event) =>
		{
			const db = /** @type {IDBOpenDBRequest} */ (event.target).result;

			try
			{

				for(let key in stores)
				{
					let storeName = stores[key].key;
					let keyPath = stores[key].value.item1;
					let columnNames = stores[key].value.item2;

					if(!keyPath || keyPath.length == 0) throw new Error('Keypath invalid for: ' + JSON.stringify(stores[key]));

					// If the store already exists, delete it so we can refresh the indexes
					if(db.objectStoreNames.contains(storeName))
					{
						continue;
					}

					const store = db.createObjectStore(storeName, { keyPath: keyPath });

					columnNames.forEach(col =>
					{
						if(col.key !== keyPath)
						{
							store.createIndex(col.key, col.value, { unique: false });
						}
					});

				}

				created = true;

			} catch(ex)
			{
				debugger;
				error = ('' + ex) + ' on ' + JSON.stringify(stores);
				throw ex;
			}
		};
		request.onsuccess = () => rs({ item1: created, item2: error ? ('' + error) : (created ? "upgraded" : "finished") });
		request.onerror = () =>
		{
			console.error(request.error);
			return rj(request.error);
		};
		request.onblocked = () => rj("Database upgrade blocked. Close other tabs.");
	});
}

localSelf.setupDatabase = setupDatabase;

/**
 *
 * @param {string} storeName
 * @param {import('../bundle/local.d').FileRecord} record
 * @param {string | null} dbName
 * @returns
 */
async function putRecordInternal(storeName, record, dbName = null)
{
	const filePath = dbName + '/' + record.path;
	const newRecord = Object.assign({}, record, {
		timestamp: record.timestamp,
		mode: record.mode,
		contents: record.contents,
		path: record.path,
		sha: record.sha,
		parent: record.parent
	});

	const newerContents = localSelf.FS?.virtual[filePath]?.contents
		|| localSelf.FS?.virtual[record.path]?.contents;

	if(localSelf.FS?.virtual[filePath]?.timestamp
		&& record.timestamp
		&& localSelf.FS.virtual[filePath]?.timestamp > record.timestamp)
	{
		if(newerContents instanceof ArrayBuffer)
		{
			newRecord.contents = new Uint8Array(newerContents);
		}
		else if(newerContents instanceof Uint8Array)
		{
			newRecord.contents = newerContents.slice(0);
		}
	}

	if(newRecord.contents instanceof ArrayBuffer)
	{
		newRecord.contents = new Uint8Array(newRecord.contents);
	}
	else if(newRecord.contents instanceof Uint8Array)
	{
		newRecord.contents = newRecord.contents.slice(0);
	}

	if(newRecord.path.includes('//') || newRecord.path.includes('http:'))
	{
		console.error('LEARN HOW TO FUCKING PROGRAM: ' + newRecord.path);
		debugger;
		throw new Error('LEARN HOW TO FUCKING PROGRAM: ' + newRecord.path);
	}
	if(!newRecord.path
		|| newRecord.path === 'assets'
		//    || newRecord.path.includes('.qvm')
	)
	{
		debugger;
	}

	const db = await getDB(dbName, false);
	const tx = db.transaction(storeName, 'readwrite');
	const store = tx.objectStore(storeName);
	return new Promise((rs, rj) =>
	{

		const req = store.put(newRecord);
		tx.oncomplete = function () { rs(req.result); };
		req.onerror = () =>
		{
			console.error(req.error);
			return rj(req.error);
		};
		tx.commit();
	});
}


/** @type {Record<string, Record<string, import('../bundle/local.d').DebounceToken>>} */
const getBounceRegistry = {
	'put': {},
	'get': {},
	'query': {},
	'cache': {},
};




/**
 * @param {string} storeName
 * @param {import('../bundle/local.d').FileRecord} record
 * @param {string | null} dbName
 * @param {boolean} noBounce
 **/
async function putRecord(storeName, record, dbName = null, noBounce = false)
{
	return await debounceRecords(storeName, 'path', record, null, null, dbName, 'put', noBounce);
}

localSelf.putRecord = putRecord;


/**
 * Retrieves a record from IndexedDB.
 *
 * @param {string} storeName - The name of the object store.
 * @param {any} record - The key, query, or record payload to look up.
 * @param {string | null} [dbName=null] - Optional database name override.
 * @param {boolean} [noBounce=false] - Whether to bypass debouncing.
 * @returns {Promise<any>}
 */
async function getRecord(storeName, record, dbName = null, dbVersion = 1, noBounce = false)
{
	return await debounceRecords(storeName, 'path', record, dbVersion, null, dbName, 'get', noBounce);
}

localSelf.getRecord = getRecord;


/**
 *
 * @param {string} storeName
 * @param {string} indexName
 * @param {any} exactIndex
 * @param {any} lower
 * @param {any} upper
 * @param {string | null} dbName
 * @param {boolean} noBounce
 * @returns
 */
async function queryIndex(storeName, indexName, exactIndex = null, lower = null, upper = null, dbName = null, noBounce = false)
{
	return await debounceRecords(storeName, indexName, exactIndex, lower, upper, dbName, 'query', noBounce);
}

localSelf.queryIndex = queryIndex;

/**
 *
 * @param {string} storeName
 * @param {string} indexName
 * @param {any} record
 * @param {any} lower
 * @param {any} upper
 * @param {string | null | undefined} dbName
 * @param {'get' | 'put' | 'query' | 'cache'} MODE
 * @param {boolean} noBounce
 * @returns {Promise<any> | null | undefined}
 */
function debounceRecords(storeName, indexName, record, lower, upper, dbName, MODE = 'get', noBounce = false)
{
	const path = typeof record === 'string' ? record : record?.path || '';
	const parts = dbName?.split('/');
	const ownerName = parts?.length === 2 ? parts[0] : localSelf.RepositoryToolbar?.owner?.value || '';
	const repoName = parts?.length === 2 ? parts[1] : (parts?.[0] || localSelf.RepositoryToolbar?.repository?.value || '');

	// 1. Generate a comprehensive unique composite signature key out of all input arguments
	// This isolates variations in stores, indices, query ranges, and databases entirely.
	const compositeArgs = {
		storeName,
		indexName,
		path,
		lower: lower ?? null,
		upper: upper ?? null,
		dbName
	};
	const registryKey = JSON.stringify(compositeArgs);

	// 2. If bypass flag is explicit, execute immediate persistence pass
	if(noBounce)
	{
		if(getBounceRegistry[MODE][registryKey])
		{
			if(getBounceRegistry[MODE][registryKey].timer)
			{
				clearTimeout(getBounceRegistry[MODE][registryKey].timer);
			}
			getBounceRegistry[MODE][registryKey].reject?.(new Error("Superseded by immediate write"));
			delete getBounceRegistry[MODE][registryKey];
		}

		if(MODE === 'get')
			return getRecordInternal(storeName, record, dbName, lower);
		else if(MODE === 'put')
			return putRecordInternal(storeName, record, dbName);
		else if(MODE === 'query')
			return queryIndexInternal(storeName, indexName, record, lower, upper, dbName); // Fixed typo: passed indexName
		else if(MODE === 'cache')
			return localSelf.cacheFileInternal?.(storeName, ownerName, repoName, record, lower, upper);
		else
			throw new Error('MODE not recognized in debounceRecords: ' + MODE);
	}

	// 3. If a delayed operation with matching signature exists, reset clock AND update references
	if(getBounceRegistry[MODE][registryKey])
	{
		if(getBounceRegistry[MODE][registryKey].timer)
		{
			clearTimeout(getBounceRegistry[MODE][registryKey].timer);
		}

		// CRITICAL FIX: Refresh execution parameters in storage to defeat closure scope stalling!
		getBounceRegistry[MODE][registryKey].latestArgs = { storeName, indexName, record, lower, upper, dbName, ownerName, repoName };
	} else
	{
		// Instantiate a fresh tracking token structural block
		getBounceRegistry[MODE][registryKey] = {
			promise: null,
			resolve: null,
			reject: null,
			timer: null,
			latestArgs: { storeName, indexName, record, lower, upper, dbName, ownerName, repoName }
		};

		getBounceRegistry[MODE][registryKey].promise = new Promise((res, rej) =>
		{
			getBounceRegistry[MODE][registryKey].resolve = res;
			getBounceRegistry[MODE][registryKey].reject = rej;
		});
	}

	// 4. Queue up execution pass mapped directly to the composite signature entry
	getBounceRegistry[MODE][registryKey].timer = setTimeout(async () =>
	{
		const currentExecutionState = getBounceRegistry[MODE][registryKey];

		if(!currentExecutionState)
		{
			console.warn(`Callback for key structure was superseded or cleared before execution.`);
			return;
		}

		// Destructure the fresh updated configuration parameter variables safely out of state tracking
		const {
			storeName: sName, indexName: iName, record: rec,
			lower: low, upper: up, dbName: dName,
			ownerName: oName, repoName: rName
		} = currentExecutionState.latestArgs;

		try
		{
			let result;
			if(MODE === 'get')
				result = await getRecordInternal(sName, rec, dName, low);
			else if(MODE === 'put')
				result = await putRecordInternal(sName, rec, dName);
			else if(MODE === 'query')
				result = await queryIndexInternal(sName, iName, rec, low, up, dName);
			else if(MODE === 'cache')
				result = await localSelf.cacheFileInternal?.(sName, oName, rName, rec, low, up);
			else
				throw new Error('MODE not recognized in debounceRecords: ' + MODE);

			currentExecutionState.resolve?.(result);
		} catch(err)
		{
			if(currentExecutionState && typeof currentExecutionState.reject === 'function')
			{
				currentExecutionState.reject(err);
			}
		} finally
		{
			// Safe garbage collection loop execution pass
			if(getBounceRegistry[MODE] && getBounceRegistry[MODE][registryKey] === currentExecutionState)
			{
				delete getBounceRegistry[MODE][registryKey];
			}
		}
	}, DB_DEBOUNCE_INTERVAL);

	return getBounceRegistry[MODE][registryKey].promise;
}

localSelf.debounceRecords = debounceRecords;

/**
 *
 * @param {string} storeName
 * @param {string} key
 * @param {string | null} dbName
 * @param {number} dbVersion
 * @returns
 */
async function getRecordInternal(storeName, key, dbName = null, dbVersion = 1)
{
	const db = await getDB(dbName, dbVersion);
	const tx = db.transaction(storeName, 'readonly');
	const store = tx.objectStore(storeName);

	return new Promise((rs, rj) =>
	{
		/** @type {import('../bundle/local.d').FileRecord | null} */
		let result = null;
		const req = store.get(key);

		req.onsuccess = () =>
		{
			// Capture the raw record out of the request immediately
			result = req.result;
		};

		// Bind resolution to the Transaction's explicit completion event
		tx.oncomplete = () =>
		{
			// 1. If no record was found, exit early with null
			if(!result)
			{
				return rs(null);
			}

			// 2. Safely fix the Symmetrical Path / "Homeless Node" issue
			if(result.parent === null || result.parent === undefined)
			{
				const path = result.path || "";
				const lastSlash = path.lastIndexOf('/');

				if(lastSlash <= 0)
				{
					result.parent = '/';
				} else
				{
					result.parent = path.substring(0, lastSlash);
				}
			}

			rs(result);
		};

		// Trap failures cleanly at both the request and transaction boundaries
		req.onerror = () => rj(req.error);
		tx.onerror = () =>
		{
			console.error("IDB Transaction Failed for getRecord:", tx.error);
			rj(tx.error);
		};
		tx.onabort = () => rj(new Error("Transaction aborted"));
	});
}



/**
 *
 * @param {string} storeName
 * @param {string} indexName
 * @param {any} exactIndex
 * @param {any} lower
 * @param {any} upper
 * @param {string | null} dbName
 * @returns
 */
async function queryIndexInternal(storeName, indexName, exactIndex = null, lower = null, upper = null, dbName = null)
{
	const db = await getDB(dbName, false);
	const tx = db.transaction(storeName, 'readonly');
	const store = tx.objectStore(storeName);
	const index = store.index(indexName || store.keyPath);

	let range = null;
	if(exactIndex !== null)
	{
		range = IDBKeyRange.only(Array.isArray(index.keyPath) && !(Array.isArray(exactIndex)) ? [exactIndex] : exactIndex);
	} else if(upper !== null && lower !== null)
	{
		range = IDBKeyRange.bound(Array.isArray(index.keyPath) && !(Array.isArray(lower)) ? [lower] : lower,
			Array.isArray(index.keyPath) && !(Array.isArray(upper)) ? [upper] : upper);
	} else if(upper !== null)
	{
		range = IDBKeyRange.upperBound(Array.isArray(index.keyPath) && !(Array.isArray(upper)) ? [upper] : upper);
	} else if(lower !== null)
	{
		range = IDBKeyRange.lowerBound(Array.isArray(index.keyPath) && !(Array.isArray(lower)) ? [lower] : lower);
	} else
	{
		range = null; // Get all records
	}


	return new Promise((rs, rj) =>
	{
		let req;
		if(indexName != null)
		{
			req = index.getAll(range);
		}
		else
		{
			req = store.getAll(range);
		}
		req.onsuccess = () =>
		{
			//console.log(req.result)
			return rs(req.result);
		};
		req.onerror = () =>
		{
			console.error(req.error);
			return rj(req.error);
		};
	});
}


/**
 *
 * @param {string} storeName
 * @param {any} key
 * @param {string | null} dbName
 * @returns
 */
async function deleteRecord(storeName, key, dbName = null)
{
	const db = await getDB(dbName);
	const tx = db.transaction(storeName, 'readwrite');
	const store = tx.objectStore(storeName);
	return new Promise((rs, rj) =>
	{
		const req = store.delete(key);
		tx.oncomplete = function () { rs(true); };
		req.onerror = () =>
		{
			console.error(req.error);
			return rj(req.error);
		};
		tx.commit();
	});
}

localSelf.deleteRecord = deleteRecord;


/**
 *
 * @param {string} dbName
 * @param {((item: any) => void) | undefined} callback
 * @returns {Promise<any[]>}
 */
async function readAll(dbName, callback = void 0)
{
	// ... your existing setup/install logic ...

	let db = await getDB(dbName);
	let transaction = db.transaction([DB_STORE_NAME], 'readonly');
	let objStore = transaction.objectStore(DB_STORE_NAME);

	// getAll() returns an array of all objects in the store immediately
	const request = objStore.getAll();

	return new Promise((resolve, reject) =>
	{
		request.onsuccess = async (/** @type {Event & { target: IDBRequest }} */ event) =>
		{
			const allItems = event.target.result;

			if(callback && typeof callback === 'function')
			{
				// You can pass the whole array to your callback at once
				allItems.forEach(callback);
			}
			resolve(allItems);
		};

		request.onerror = (/** @type {Error} */ err) =>
		{
			console.error("IndexedDB Read Error:", err);
			reject(err);
		};
	});
}

localSelf.readAll = readAll;


/**
 *
 * @param {string} globPattern
 * @returns
 */
function findVirtualFiles(globPattern)
{
	const filePaths = Object.keys(localSelf.FS.virtual);
	const rx = globToRegex(globPattern);

	return filePaths.reduce((/** @type {Record<string, import('../bundle/local.d').FileRecord | null | undefined>} */ accumulator, /** @type {string} */ path) =>
	{
		if(rx.test(path))
		{
			accumulator[path] = localSelf.FS.virtual[path];
		}
		return accumulator;
	}, {});
}

/**
 *
 * @param {string} pattern
 * @param {boolean} caseSensitive
 * @returns {RegExp}
 */
function globToRegex(pattern, caseSensitive = false)
{
	// Clean up leading/trailing slashes so matching is uniform
	let cleaned = pattern.trim();
	if(cleaned.startsWith('/')) cleaned = cleaned.substring(1);

	let regexStr = cleaned
		.replace(/([.+^=!:${}()|\[\]\/\\])/g, "\\$1") // 1. Escape regex specials
		.replace(/\x2A\x2A/g, ".*")                   // 2. ** -> match anything
		.replace(/(?<!\.)\x2A/g, "[^\\/]*")           // 3. * -> match except slashes (ignore translated .*)
		.replace(/\x3F/g, ".");                      // 4. ? -> match single char

	// If it ends with .*, make the trailing slash context optional
	if(regexStr.endsWith('.*'))
	{
		regexStr = regexStr.replace(/\\\/.*$/, "(?:\\/.*)?");
	}

	// Match either from the root of the repository or as a segment within it
	return new RegExp(`^(?:.*\\/)?${regexStr}$`, !caseSensitive ? "i" : void 0);
}

localSelf.globToRegex = globToRegex;
