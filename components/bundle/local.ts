// --- Type Definitions & Interfaces ---

import { cacheFileInternal } from "./github-tools";
import { FS } from "./global";
import type { RepositoryToolbar } from "./menu-repos";
import type {
	LocalWindow, DatabaseMetadata, FileRecord,
	SchemaStoreConfig, DebounceToken, InstallCheckResult,
	SetupDatabaseResult
} from './local.d';
import type { GlobalToolbarsWindow } from "./menu.d";


const localSelf: LocalWindow & GlobalToolbarsWindow = self as unknown as any;



export const DB_VERSION = 1; // Increment this when you add new C# Entities!
export const DB_NAME = "briancullinan2/gameserver-ts";
localSelf.DB_NAME = DB_NAME;
export const DB_STORE_NAME = 'FILE_DATA';
localSelf.DB_STORE_NAME = DB_STORE_NAME;
export const DB_DEBOUNCE_INTERVAL = 50;

export const ST_FILE = 8;
localSelf.ST_FILE = ST_FILE;
export const ST_DIR = 4;
localSelf.ST_DIR = ST_DIR;
export const FS_DEFAULT = (6 << 3) + (6 << 6) + (6);
export const FS_FILE = (ST_FILE << 12) + FS_DEFAULT;
localSelf.FS_FILE = FS_FILE;
export const FS_DIR = (ST_DIR << 12) + FS_DEFAULT;
localSelf.FS_DIR = FS_DIR;

export const DB_SCHEME: SchemaStoreConfig[] = [
	{
		key: DB_STORE_NAME,
		value: {
			item1: 'path',
			item2: [
				{ key: 'timestamp', value: 'timestamp' },
				{ key: 'parent', value: 'parent' }
			]
		}
	}
];

const getBounceRegistry: Record<string, Record<string, DebounceToken>> = {
	'put': {},
	'get': {},
	'query': {},
	'cache': {},
};

// --- Core Database Utility Functions ---

export async function getDB(dbName: string | null = null, dbVersion: number | boolean | null = null): Promise<IDBDatabase>
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
	});
}

localSelf.getDB = getDB;

export async function deleteOldDatabase(dbName: string | null = null): Promise<boolean>
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

export async function getDatabaseMetadata(): Promise<DatabaseMetadata[]>
{
	// Returns a list of { name, version } objects
	// Note: this may not be supported in very old WebViews, but works in modern MAUI
	if(!indexedDB.databases)
	{
		return [];
	}
	const dbs = await indexedDB.databases();
	return dbs.map(db => ({ key: db.name || '', value: db.version || 0 }));
}

localSelf.getDatabaseMetadata = getDatabaseMetadata;

export async function needsInstall(dbName: string | null, expectedStores: SchemaStoreConfig[]): Promise<InstallCheckResult>
{
	return new Promise((resolve) =>
	{
		const request = indexedDB.open(dbName || DB_NAME);

		request.onsuccess = (event: any) =>
		{
			const db = event.target.result as IDBDatabase;
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
			console.error(request.error);
			return resolve({
				item1: dbName || DB_NAME,
				item2: DB_VERSION,
				item3: true,
				item4: expectedStores.map(s => s.key)
			});
		};
	});
}

localSelf.needsInstall = needsInstall;

export async function setupDatabase(dbName: string, stores: SchemaStoreConfig[]): Promise<SetupDatabaseResult>
{
	let created = false;
	let error: string | null = null;

	if(dbName.length < 4 || dbName.startsWith('/'))
	{
		debugger;
		console.error('how the fuck does this even happen?');
		throw new Error('how the fuck does this even happen?');
	}

	return new Promise((rs, rj) =>
	{
		const request = indexedDB.open(dbName || DB_NAME, DB_VERSION);

		request.onupgradeneeded = (event: any) =>
		{
			const db = event.target.result as IDBDatabase;

			try
			{
				for(const key in stores)
				{
					if(!Object.prototype.hasOwnProperty.call(stores, key)) continue;

					const storeName = stores[key].key;
					const keyPath = stores[key].value.item1;
					const columnNames = stores[key].value.item2;

					if(!keyPath || keyPath.length === 0)
					{
						throw new Error('Keypath invalid for: ' + JSON.stringify(stores[key]));
					}

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
			} catch(ex: any)
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

// --- Internal Engine Logic Operations ---

async function putRecordInternal(storeName: string, record: FileRecord, dbName: string | null = null): Promise<any>
{
	const filePath = dbName + '/' + record.path;
	const newRecord: FileRecord = Object.assign({}, record, {
		timestamp: record.timestamp,
		mode: record.mode,
		contents: record.contents,
		path: record.path,
		sha: record.sha,
		parent: record.parent
	});
	const newerContents = FS.virtual[filePath]?.contents
		?? FS.virtual[record.path]?.contents;
	if(FS.virtual[filePath]?.timestamp
		&& record.timestamp
		&& FS.virtual[filePath]?.timestamp > record.timestamp)
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

	// in case temporary buffers are sent
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
	if(!newRecord.path || newRecord.path === 'assets')
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

async function getRecordInternal(storeName: string, key: string, dbName: string | null = null, dbVersion: number = 1): Promise<FileRecord | null>
{
	const db = await getDB(dbName, dbVersion);
	const tx = db.transaction(storeName, 'readonly');
	const store = tx.objectStore(storeName);

	return new Promise((rs, rj) =>
	{
		let result: FileRecord | null = null;
		const req = store.get(key);

		req.onsuccess = () =>
		{
			result = req.result;
		};

		tx.oncomplete = () =>
		{
			if(!result)
			{
				return rs(null);
			}

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

		req.onerror = () => rj(req.error);
		tx.onerror = () =>
		{
			console.error("IDB Transaction Failed for getRecord:", tx.error);
			rj(tx.error);
		};
		tx.onabort = () => rj(new Error("Transaction aborted"));
	});
}

async function queryIndexInternal(
	storeName: string,
	indexName: string | null,
	exactIndex: any = null,
	lower: any = null,
	upper: any = null,
	dbName: string | null = null
): Promise<any[]>
{
	const db = await getDB(dbName, false);
	const tx = db.transaction(storeName, 'readonly');
	const store = tx.objectStore(storeName);
	const index = store.index(indexName || (store.keyPath as string));

	let range: IDBKeyRange | null = null;
	if(exactIndex !== null)
	{
		range = IDBKeyRange.only(Array.isArray(index.keyPath) && !Array.isArray(exactIndex) ? [exactIndex] : exactIndex);
	} else if(upper !== null && lower !== null)
	{
		range = IDBKeyRange.bound(
			Array.isArray(index.keyPath) && !Array.isArray(lower) ? [lower] : lower,
			Array.isArray(index.keyPath) && !Array.isArray(upper) ? [upper] : upper
		);
	} else if(upper !== null)
	{
		range = IDBKeyRange.upperBound(Array.isArray(index.keyPath) && !Array.isArray(upper) ? [upper] : upper);
	} else if(lower !== null)
	{
		range = IDBKeyRange.lowerBound(Array.isArray(index.keyPath) && !Array.isArray(lower) ? [lower] : lower);
	}

	return new Promise((rs, rj) =>
	{
		const req = indexName != null ? index.getAll(range) : store.getAll(range);
		req.onsuccess = () => rs(req.result);
		req.onerror = () =>
		{
			console.error(req.error);
			return rj(req.error);
		};
	});
}

// --- Public Anti-Throttling Debounce Intermediaries ---

export async function putRecord(storeName: string, record: FileRecord, dbName: string | null = null, noBounce: boolean = false): Promise<any>
{
	return await debounceRecords(storeName, 'path', record, null, null, dbName, 'put', noBounce);
}

localSelf.putRecord = putRecord;

export async function getRecord(storeName: string, record: string, dbName: string | null = null, dbVersion = 1, noBounce = false): Promise<FileRecord | null>
{
	return await debounceRecords(storeName, 'path', record, dbVersion, null, dbName, 'get', noBounce);
}

localSelf.getRecord = getRecord;

export async function queryIndex(
	storeName: string,
	indexName: string,
	exactIndex: any = null,
	lower: any = null,
	upper: any = null,
	dbName: string | null = null,
	noBounce = false
): Promise<any[]>
{
	return await debounceRecords(storeName, indexName, exactIndex, lower, upper, dbName, 'query', noBounce);
}

localSelf.queryIndex = queryIndex;

export function debounceRecords(
	storeName: string,
	indexName: string,
	record: any,
	lower: any,
	upper: any,
	dbName: string | null | undefined,
	MODE: 'put' | 'get' | 'query' | 'cache' = 'get',
	noBounce = false
): Promise<any>
{
	const path: string = typeof record === 'string' ? record : record?.path || '';
	const parts = (dbName || '').split('/');
	const ownerName = parts.length === 2 ? parts[0] : (typeof localSelf.RepositoryToolbar?.owner !== 'undefined' ? localSelf.RepositoryToolbar.owner?.value ?? '' : '');
	const repoName = parts.length === 2 ? parts[1] : (parts[0] || (typeof localSelf.RepositoryToolbar?.repository !== 'undefined' ? localSelf.RepositoryToolbar.repository?.value ?? '' : ''));

	const compositeArgs = {
		storeName,
		indexName,
		path,
		lower: lower ?? null,
		upper: upper ?? null,
		dbName
	};
	const registryKey = JSON.stringify(compositeArgs);

	if(noBounce)
	{
		if(getBounceRegistry[MODE][registryKey])
		{
			const token = getBounceRegistry[MODE][registryKey];
			if(token.timer) clearTimeout(token.timer);
			if(token.reject) token.reject(new Error("Superseded by immediate write"));
			delete getBounceRegistry[MODE][registryKey];
		}

		if(MODE === 'get') return getRecordInternal(storeName, record, dbName, lower);
		if(MODE === 'put') return putRecordInternal(storeName, record, dbName);
		if(MODE === 'query') return queryIndexInternal(storeName, indexName, record, lower, upper, dbName);
		if(MODE === 'cache') return cacheFileInternal(storeName, ownerName, repoName, record, lower, upper);
		throw new Error('MODE not recognized in debounceRecords: ' + MODE);
	}

	if(getBounceRegistry[MODE][registryKey])
	{
		const token = getBounceRegistry[MODE][registryKey];
		if(token.timer) clearTimeout(token.timer);
		token.latestArgs = { storeName, indexName, record, lower, upper, dbName, ownerName, repoName };
	} else
	{
		const token: DebounceToken = {
			promise: null,
			resolve: null,
			reject: null,
			timer: null,
			latestArgs: { storeName, indexName, record, lower, upper, dbName, ownerName, repoName }
		};

		token.promise = new Promise((res, rej) =>
		{
			token.resolve = res;
			token.reject = rej;
		});

		getBounceRegistry[MODE][registryKey] = token;
	}

	getBounceRegistry[MODE][registryKey].timer = setTimeout(async () =>
	{
		const currentExecutionState = getBounceRegistry[MODE][registryKey];
		if(!currentExecutionState)
		{
			console.warn(`Callback for key structure was superseded or cleared before execution.`);
			return;
		}

		const {
			storeName: sName, indexName: iName, record: rec,
			lower: low, upper: up, dbName: dName,
			ownerName: oName, repoName: rName
		} = currentExecutionState.latestArgs;

		try
		{
			let result: any;
			if(MODE === 'get') result = await getRecordInternal(sName, rec, dName, low);
			else if(MODE === 'put') result = await putRecordInternal(sName, rec, dName);
			else if(MODE === 'query') result = await queryIndexInternal(sName, iName, rec, low, up, dName);
			else if(MODE === 'cache') result = await cacheFileInternal(sName, oName, rName, rec, low, up);
			else throw new Error('MODE not recognized in debounceRecords: ' + MODE);

			if(currentExecutionState.resolve) currentExecutionState.resolve(result);
		} catch(err)
		{
			if(currentExecutionState && typeof currentExecutionState.reject === 'function')
			{
				currentExecutionState.reject(err);
			}
		} finally
		{
			if(getBounceRegistry[MODE] && getBounceRegistry[MODE][registryKey] === currentExecutionState)
			{
				delete getBounceRegistry[MODE][registryKey];
			}
		}
	}, DB_DEBOUNCE_INTERVAL);

	return getBounceRegistry[MODE][registryKey].promise!;
}

localSelf.debounceRecords = debounceRecords;

export async function deleteRecord(storeName: string, key: string, dbName: string | null = null): Promise<boolean>
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

export async function readAll(dbName: string, callback?: (item: any) => void): Promise<any[]>
{
	const db = await getDB(dbName);
	const transaction = db.transaction([DB_STORE_NAME], 'readonly');
	const objStore = transaction.objectStore(DB_STORE_NAME);
	const request = objStore.getAll();

	return new Promise((resolve, reject) =>
	{
		request.onsuccess = (event: any) =>
		{
			const allItems = event.target.result as any[];
			if(callback && typeof callback === 'function')
			{
				allItems.forEach(callback);
			}
			resolve(allItems);
		};

		request.onerror = (err) =>
		{
			console.error("IndexedDB Read Error:", err);
			reject(err);
		};
	});
}

localSelf.readAll = readAll;

// --- Virtual Paths Global VFS System Glob Filters ---

export function findVirtualFiles(globPattern: string): Record<string, FileRecord>
{
	if(typeof FS === 'undefined' || !FS.virtual) return {};
	const filePaths = Object.keys(FS.virtual);
	const rx = globToRegex(globPattern);

	return filePaths.reduce((accumulator: Record<string, FileRecord>, path) =>
	{
		if(rx.test(path) && FS.virtual[path])
		{
			accumulator[path] = FS.virtual[path];
		}
		return accumulator;
	}, {});
}

export function globToRegex(pattern: string, caseSensitive: boolean = false): RegExp
{
	let cleaned = pattern.trim();
	if(cleaned.startsWith('/')) cleaned = cleaned.substring(1);

	let regexStr = cleaned
		.replace(/([.+^=!:${}()|\[\]\/\\])/g, "\\$1")
		.replace(/\x2A\x2A/g, ".*")
		.replace(/(?<!\.)\x2A/g, "[^\\/]*")
		.replace(/\x3F/g, ".");

	if(regexStr.endsWith('.*'))
	{
		regexStr = regexStr.replace(/\\\/.*$/, "(?:\\/.*)?");
	}

	return new RegExp(`^(?:.*\\/)?${regexStr}$`, !caseSensitive ? "i" : void 0);
}

localSelf.globToRegex = globToRegex;

