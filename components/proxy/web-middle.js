
/// <reference types="node" />
// @ts-check

const fs = require('fs');
const path = require('path');
const Stream = require('stream');
const { findFile, makeDirectoryHtml, layeredDir } = require('./web-layered');
const { customMimeTypes, ASSETS_DIRECTORY } = require('./web-config');
const { body } = require('happy-dom/lib/PropertySymbol');
// TODO: make this a configurable list instead
const PUBLIC_HOST = 'localhost:4004';

/**
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Function} next
 * @returns
 */

function middleware(req, res, next)
{
	// Essential for CORS in Workers
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
	res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

	// Essential for SharedArrayBuffer / Cross-Origin Isolation
	res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
	res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
	res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

	res.setHeader('Content-Security-Policy', "script-src 'self' 'unsafe-eval' 'sha256-iN7wpJdxHlpujRppkOA8N0+Mzp0ZqZr3lCtxM00Y63c='; worker-src 'self' blob:;");
	res.setHeader('Permissions-Policy', 'cross-origin-isolated=(*)');

	if(req.method === 'OPTIONS')
	{
		res.statusCode = 204;
		return res.end();
	}

	next();
}




let latestMtime = new Date();

//let fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
/**
 *
 * @param {import('./web-workers').HttpRequestMessage} request
 * @returns {Promise<import('./web-workers').HttpResponseMessage>}
 */
async function respondRequest(request)
{
	//const { execSync } = require('child_process');
	let localName = request.url ?? 'index.html';
	try
	{
		const requestUrl = new URL(!request.url?.includes('://') ? (PUBLIC_HOST + request.url) : (request.url ?? 'index.html'), PUBLIC_HOST);
		if(request.url && requestUrl.host)
		{
			localName = requestUrl.host + '/' + requestUrl.pathname;
		}
		if(localName[0] == '/')
		{
			localName = localName.substring(1);
		}
	} catch(e)
	{
		console.error(e);
	}
	// remove MAINMENU from path
	// let menuDir = localName.substring(localName.lastIndexOf('/'));
	// if(MENU_PATHS.includes(menuDir.toUpperCase()))
	// {
	// 	localName = localName.substring(0, localName.length - menuDir.length);
	// }
	if(localName.endsWith('/'))
	{
		localName = localName.substring(0, localName.length - 1);
	}


	let file;
	// send files that exist in the layered file-system
	if((file = findFile(localName)))
	{
		const ext = path.extname(file).toLowerCase();
		const headers = typeof customMimeTypes[ext] === 'string'
			? { 'Content-Type': customMimeTypes[ext] }
			: undefined;
		// TODO: if loading a directory return a formatted file index HTML directory listing
		if(fs.statSync(file).isDirectory())
		{
			if((file = findFile(path.join(localName, 'index.html'))))
			{
				return {
					requestId: request.requestId,
					statusCode: 200,
					body: fs.readFileSync(path.resolve(file))
				};
			} else
			{
				let list = layeredDir(localName);
				return {
					requestId: request.requestId,
					body: makeDirectoryHtml(localName, list)
				};
			}
		}
		/*else if(fs.statSync(file).size > 5 * 1024 * 1024)
		{
			return {
				requestId: request.requestId,
				statusCode: 307,
				headers: {
					'Location': PUBLIC_HOST ?? requestUrl.protocol + '://' + requestUrl.hostname +
				}
			};
		} */
		else if(request.headers['accept-encoding'])
		{
			return await sendCompressed(path.resolve(file), request.headers['accept-encoding']);
		}
		else
		{
			return {
				body: fs.readFileSync(path.resolve(file))
			};
		}
	}


	// TODO: convert paths like *.pk3dir and *.pk3 to their zip counterparts and stream
	// TODO: if loading a path out of a .pk3 file, return it as a directory


	// always make a version file in live-reload mode
	if(localName.match('version.json'))
	{
		let newPath = path.join(ASSETS_DIRECTORY, 'version.json');
		if(!fs.existsSync(newPath))
		{
			writeVersionFile(latestMtime);
		}
		return {
			body: fs.readFileSync(path.resolve(newPath))
		};
	}


	if((file = findFile('index.html')))
	{
		// if loading a missing path return the index page
		if(localName.length < 2)
		{ // index page?
			return {
				body: fs.readFileSync(path.resolve(file))
			};
		}
	}

	return {
		statusCode: 404
	};
}


/** @type {import('zlib')} */
let zlib;
/** @type {import('mime').Mime} */
let mime;
/**
 *
 * @param {string} file
 * @param {string[] | string} acceptEncoding
 * @return {Promise<import('./web-workers').HttpResponseMessage>}
 */
async function sendCompressed(file, acceptEncoding)
{
	const turnOffCompression = true;
	if(!zlib)
	{
		zlib = require('zlib');
	}
	if(!mime)
	{
		const standardTypes = await import('mime/types/standard.js');
		const otherTypes = await import('mime/types/other.js');
		mime = new (await import('mime')).Mime(/** @type {any} */ standardTypes.default, otherTypes.default, {
			'application/wasm': ['wasm'],
			'application/octet-stream': ['pk3']
		});
	}
	/** @type {Stream} */
	let readStream = fs.createReadStream(file);
	/** @type {Record<string, string>} */
	const headers = {
		'Cache-Control': 'public, max-age=' + (path.resolve(file).startsWith(path.resolve(__dirname, '..')) ? 0 : 31557600),
		'Content-Type': mime.getType(file) ?? 'application/octet-stream',
	};
	let contentLength = 0;
	// if compressed version already exists, send it directly
	if(!turnOffCompression && acceptEncoding.includes('br'))
	{
		headers['Content-Encoding'] = 'br';
		if(fs.existsSync(file + '.br'))
		{
			contentLength = fs.statSync(file + '.br').size;
			readStream = fs.createReadStream(file + '.br');
		} else
		{
			readStream = readStream.pipe(zlib.createBrotliCompress());
		}
	} else if(!turnOffCompression && acceptEncoding.includes('gzip'))
	{
		headers['Content-Encoding'] = 'gzip';
		if(fs.existsSync(file + '.gz'))
		{
			contentLength = fs.statSync(file + '.gz').size;
			readStream = fs.createReadStream(file + '.gz');
		} else
		{
			readStream = readStream.pipe(zlib.createGzip());
		}
	} else if(!turnOffCompression && acceptEncoding.includes('deflate'))
	{
		headers['Content-Encoding'] = 'deflate';
		if(fs.existsSync(file + '.df'))
		{
			contentLength = fs.statSync(file + '.df').size;
			readStream = fs.createReadStream(file + '.df');
		} else
		{
			readStream = readStream.pipe(zlib.createDeflate());
		}
	} else
	{
		contentLength = fs.statSync(file).size;
	}
	headers['Content-Length'] = '' + contentLength;

	return {
		headers,
		body: readStream,
	};
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let fileTimeout;

/**
 *
 * @param {Date} time
 */
function writeVersionFile(time)
{
	console.log('Updating working directory...');
	// debounce file changes for a second in case there is a copy process going on
	if(fileTimeout)
	{
		clearTimeout(fileTimeout);
	}
	fileTimeout = setTimeout(function ()
	{
		try
		{
			if(!time) time = new Date();
			// refresh any connected clients
			require('fs').writeFileSync(
				path.join(ASSETS_DIRECTORY, 'version.json'),
				JSON.stringify([time, time]));
			//fs.watchFile(file, function(curr, prev) {
			//});
		} catch(e)
		{
			console.log(e);
		}
	}, 1000);

}

/** @type {({fn: Function, path: string})[]} */
const stack = [];

/**
 * Register middleware or sub-apps.
 * Express allows:
 * - app.use(fn)
 * - app.use('/path', fn)
 * - app.use(fn1, fn2, fn3)
 * - app.use('/path', fn1, fn2)
 */
/**
 *
 * @param  {...any} args
 * @returns
 */
function use(...args)
{
	let path = '/';

	// Check if the first argument is a path string
	if(typeof args[0] === 'string')
	{
		path = args.shift();
	}

	// Flatten nested arrays/arguments to support multiple middleware passed at once
	const callbacks = args.flat(Infinity);

	for(const fn of callbacks)
	{
		if(typeof fn !== 'function' && typeof fn?.handle !== 'function')
		{
			throw new TypeError('Middleware must be a function or an object with a handle method');
		}

		// Standardize path ending (ensure leading slash, no trailing slash unless root)
		const normalizedPath = _normalizePath(path);

		stack.push({
			path: normalizedPath,
			// Handle nested sub-apps (instances of ExpressMock or routers)
			fn: typeof fn.handle === 'function' ? fn.handle.bind(fn) : fn
		});
	}
}

/**
 * Dispatches incoming req/res through the registered middleware stack
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Function} [out] Optional final handler when stack exhausts
 */
function handle(req, res, out)
{
	let index = 0;

	// Express default final handler if none provided
	const finalHandler = out || (
		/**@param {any} err */
		(err) =>
		{
			if(err)
			{
				res.statusCode = res.statusCode >= 400 ? res.statusCode : 500;
				res.end(`Error: ${err.message || err}`);
			} else
			{
				res.statusCode = 404;
				res.end(`Cannot ${req.method || 'GET'} ${req.url}`);
			}
		});

	/**
	 * The core next() function passed into middleware
	 * @param {Error|string} [err]
	 * @returns
	 */
	const next = (err) =>
	{
		// Exit early if stack is fully processed
		if(index >= stack.length)
		{
			return finalHandler(err);
		}

		// Grab current layer and advance index pointer for the next iteration
		const layer = stack[index++];
		const reqPath = _normalizePath(req.url || '/');

		// 1. Path Matching: Match prefix path (e.g., '/api' matches '/api/users')
		const isPathMatch = layer.path === '/' ||
			reqPath === layer.path ||
			reqPath.startsWith(layer.path + '/');

		if(!isPathMatch)
		{
			return next(err); // Skip layer if path doesn't match
		}

		const isErrorMiddleware = layer.fn.length === 4; // Express identifies error middleware by (err, req, res, next)

		try
		{
			if(err)
			{
				// An error occurred: Only execute error-handling middleware (4 parameters)
				if(isErrorMiddleware)
				{
					layer.fn(err, req, res, next);
				} else
				{
					next(err); // Skip regular middleware
				}
			} else
			{
				// Normal execution: Skip error-handling middleware
				if(isErrorMiddleware)
				{
					next();
				} else
				{
					layer.fn(req, res, next);
				}
			}
		} catch(/** @type {any} */ caughtErr)
		{
			// Catch synchronous errors thrown inside middleware
			next(caughtErr);
		}
	};

	// Kick off the execution chain
	next();
}

/**
 * Normalizes paths for consistent prefix matching
 * @param {string} p
 * @returns {string}
 */
function _normalizePath(p)
{
	if(!p.startsWith('/')) p = '/' + p;
	if(p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
	return p;
}


module.exports = {
	respondRequest,
	middleware,
	sendCompressed,
	writeVersionFile,
	latestMtime
};
