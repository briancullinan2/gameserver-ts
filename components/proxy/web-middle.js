
/// <reference types="node" />
// @ts-check

const fs = require('fs');
const path = require('path');
const Stream = require('stream');
const { findFile, makeDirectoryHtml, layeredDir } = require('./web-layered');
const { customMimeTypes, ASSETS_DIRECTORY } = require('./web-config');

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
 * @param {import('express').Request} request
 * @param {import('express').Response} response
 * @returns
 */
async function respondRequest(request, response)
{
	const { execSync } = require('child_process');
	let localName = path.join(request.baseUrl, request.path);
	if(localName[0] == '/')
		localName = localName.substring(1);
	// remove MAINMENU from path
	let menuDir = localName.substring(localName.lastIndexOf('/'));
	// if(MENU_PATHS.includes(menuDir.toUpperCase()))
	// {
	// 	localName = localName.substring(0, localName.length - menuDir.length);
	// }
	if(localName.endsWith('/'))
	{
		localName = localName.substring(0, localName.length - 1);
	}
	//if(localName.startsWith(GAME_DIRECTORY))
	//  localName = localName.substring(GAME_DIRECTORY.length)
	//if(localName[0] == '/')
	//  localName = localName.substring(1)

	// list palette images for pk3dirs
	// if(localName.includes('.pk3dir/scripts/')
	// 	&& localName.endsWith('.shader'))
	// {
	// 	let mapName = path.basename(localName.substring(0, localName.length - 7));
	// 	let newPath = path.join(ASSETS_DIRECTORY,
	// 		localName.substring(GAME_DIRECTORY.length), '../../maps/', mapName + '.bsp');
	// 	if(fs.existsSync(newPath))
	// 	{
	// 		return makePaletteShader(localName, response);
	// 	}
	// }


	let file;
	// send files that exist in the layered file-system
	if((file = findFile(localName)))
	{
		const ext = path.extname(file).toLowerCase();
		if(typeof customMimeTypes[ext] === 'string')
		{
			response.setHeader('Content-Type', customMimeTypes[ext]);
		}
		// TODO: if loading a directory return a formatted file index HTML directory listing
		if(fs.statSync(file).isDirectory())
		{
			if((file = findFile(path.join(localName, 'index.html'))))
			{
				return response.sendFile(path.resolve(file));
			} else
			{
				let list = layeredDir(localName);
				return response.send(makeDirectoryHtml(localName, list));
			}
		} else if(request.headers['accept-encoding'])
		{
			return await sendCompressed(path.resolve(file), response, request.headers['accept-encoding']);
		} else
		{
			return response.sendFile(path.resolve(file));
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
		response.sendFile(path.resolve(newPath));
	}

	// if loading an image in a different format convert it
	// if((file = findAltImage(localName)))
	// {
	// 	let newPath = path.join(ASSETS_DIRECTORY, localName.substring(GAME_DIRECTORY.length));
	// 	let alpha = hasAlpha(file);
	// 	if((!alpha && localName.includes('.jpeg'))
	// 		|| (alpha && localName.includes('.png')))
	// 	{
	// 		execSync(`magick "${file}" -auto-orient -strip -quality 50% "${path.resolve(newPath)}"`, { stdio: 'pipe' });
	// 	}
	// 	if(fs.existsSync(newPath))
	// 	{
	// 		if(request.headers['accept-encoding'])
	// 		{
	// 			return sendCompressed(path.resolve(file), response, request.headers['accept-encoding']);
	// 		} else
	// 		{
	// 			return response.sendFile(path.resolve(newPath));
	// 		}
	// 	}
	// }

	// if loading audio in a different format
	// if((file = findAltAudio(localName)))
	// {
	// 	let newPath = path.join(ASSETS_DIRECTORY, localName.substring(GAME_DIRECTORY.length));
	// 	if(file.includes('.mp3'))
	// 	{
	// 		execSync(`ffmpeg -i "${file}" -c:a libvorbis -q:a 4 "${path.resolve(newPath)}"`, { stdio: 'pipe' });
	// 	} if(localName.includes('.ogg') || file.includes('.wav'))
	// 	{
	// 		execSync(`oggenc -q 7 --downmix --resample 11025 --quiet "${file}" -n "${path.resolve(newPath)}"`, { stdio: 'pipe' });
	// 	}
	// 	if(fs.existsSync(newPath))
	// 	{
	// 		if(request.headers['accept-encoding'])
	// 		{
	// 			return sendCompressed(path.resolve(file), response, request.headers['accept-encoding']);
	// 		} else
	// 		{
	// 			return response.sendFile(path.resolve(newPath));
	// 		}
	// 	}
	// }


	if((file = findFile('index.html')))
	{
		// if loading a missing path return the index page
		if(localName.length < 2)
		{ // index page?
			return response.sendFile(path.resolve(file));
		} else
		{
			return response.status(404).send(); //.sendFile(path.resolve(file))
		}
	}

}


/** @type {import('zlib')} */
let zlib;
/** @type {import('mime').Mime} */
let mime;
/**
 *
 * @param {string} file
 * @param {import('express').Response} res
 * @param {string[] | string} acceptEncoding
 */
async function sendCompressed(file, res, acceptEncoding)
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
	res.setHeader('cache-control', 'public, max-age=31557600');
	res.setHeader('content-type', mime.getType(file) ?? 'application/octet-stream');
	// if compressed version already exists, send it directly
	if(!turnOffCompression && acceptEncoding.includes('br'))
	{
		res.append('content-encoding', 'br');
		if(fs.existsSync(file + '.br'))
		{
			res.append('content-length', fs.statSync(file + '.br').size + '');
			readStream = fs.createReadStream(file + '.br');
		} else
		{
			readStream = readStream.pipe(zlib.createBrotliCompress());
		}
	} else if(!turnOffCompression && acceptEncoding.includes('gzip'))
	{
		res.append('content-encoding', 'gzip');
		if(fs.existsSync(file + '.gz'))
		{
			res.append('content-length', fs.statSync(file + '.gz').size + '');
			readStream = fs.createReadStream(file + '.gz');
		} else
		{
			readStream = readStream.pipe(zlib.createGzip());
		}
	} else if(!turnOffCompression && acceptEncoding.includes('deflate'))
	{
		res.append('content-encoding', 'deflate');
		if(fs.existsSync(file + '.df'))
		{
			res.append('content-length', fs.statSync(file + '.df').size + '');
			readStream = fs.createReadStream(file + '.df');
		} else
		{
			readStream = readStream.pipe(zlib.createDeflate());
		}
	} else
	{
		res.append('content-length', fs.statSync(file).size + '');
	}

	readStream.pipe(res);
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
