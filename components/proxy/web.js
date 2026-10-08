/// <reference types="node" />
// @ts-check

const fs = require('fs');
const path = require('path');
const Stream = require('stream');
const GAME_DIRECTORY = 'demoq3';
const WEB_DIRECTORY = path.resolve(__dirname + '/../../');
const ASSETS_DIRECTORY = path.resolve(__dirname + '/../../' + GAME_DIRECTORY + '/pak0.pk3dir/');
const BUILD_DIRECTORY = path.resolve(__dirname + '/../../dist/');
const ALLOWED_DIRECTORIES = [
	WEB_DIRECTORY,
	ASSETS_DIRECTORY,
	BUILD_DIRECTORY
];

const BUILD_ORDER = [
	'release-wasm-js',
	'debug-wasm-js',
	'release-js-js',
	'debug-js-js',
	'release-darwin-x86_64',
	'debug-darwin-x86_64'
];

// TODO: if trying to load menu path, return the index page
const MENU_PATHS = [
	'MAINMENU',
	'SETUP',
	'MULTIPLAYER',
	'CHOOSELEVEL',
	'ARENASERVERS',
	'DIFFICULTY',
	'PLAYERMODEL',
	'PLAYERSETTINGS',
];

/** @type {ReturnType<typeof setTimeout> | undefined} */
let fileTimeout;
let latestMtime = new Date();

/**
 *
 * @param {string} filename
 * @returns {string | undefined}
 */
function findFile(filename)
{
	// layer the file system, so no matter what we're building, the browser loads something
	for(let i = 0; i < BUILD_ORDER.length; i++)
	{
		let newPath = path.join(BUILD_DIRECTORY, BUILD_ORDER[i], filename);
		if(fs.existsSync(path.resolve(newPath)))
		{
			return newPath;
		}
	}

	if(filename.startsWith(GAME_DIRECTORY))
	{
		let newPath = path.join(ASSETS_DIRECTORY, filename.substring(GAME_DIRECTORY.length));
		if(fs.existsSync(path.resolve(newPath)))
		{
			return newPath;
		}

		if(newPath.includes('.pk3dir'))
		{
			let pk3 = path.join(BUILD_DIRECTORY, filename.substring(GAME_DIRECTORY.length));
			if(fs.existsSync(path.resolve(pk3)))
			{
				return pk3;
			}
		}
	}

	let newPath = path.join(WEB_DIRECTORY, filename);
	if(fs.existsSync(path.resolve(newPath)))
	{
		return newPath;
	}

	// TODO: more alternatives?
}


// okay this function is apparently a little idiotic and triggers on accesses
//   this is not how native notify works, but maybes it's the best they could make the same
/**
 *
 * @param {string} prefix
 * @param {string} eventType
 * @param {string} filename
 * @returns
 */
function fileChanged(prefix, eventType, filename)
{
	if(filename.includes('version.json'))
	{
		return; // this would be redundant
	}
	if(!fs.existsSync(path.join(ASSETS_DIRECTORY, prefix, filename)))
	{
		// must have been deleted
		latestMtime = new Date();
	} else
	{
		let newMtime = fs.statSync(path.join(ASSETS_DIRECTORY, prefix, filename)).mtime;
		if(newMtime > latestMtime)
		{
			latestMtime = newMtime;
		}
	}
	writeVersionFile(latestMtime);
}


function startFileWatcher()
{
	// TODO: enable file watchers in live reload mode
	//for(let i = 0; i < directories.length; i++) {
	//  fs.watch(path.join(ASSETS_DIRECTORY, directories[i]),
	//    fileChanged.bind(null, directories[i]))
	//}

}

/**
 *
 * @param {string} localName
 * @returns {string | undefined}
 */
function findAltImage(localName)
{
	// what makes this clever is it only converts when requested
	let ext = path.extname(localName);
	let strippedName = localName;
	if(ext)
	{
		strippedName = strippedName.substring(0, localName.length - ext.length);
	}
	let file;
	if((file = findFile(strippedName + '.tga')))
	{
		return file;
	}
	if((file = findFile(strippedName + '.pcx')))
	{
		return file;
	}
}


/**
 *
 * @param {string} localName
 * @returns {string | undefined}
 */
function findAltAudio(localName)
{
	// what makes this clever is it only converts when requested
	let ext = path.extname(localName);
	let strippedName = localName;
	if(ext)
	{
		strippedName = strippedName.substring(0, localName.length - ext.length);
	}
	let file;
	if((file = findFile(strippedName + '.wav')))
	{
		return file;
	}
	if((file = findFile(strippedName + '.mp3')))
	{
		return file;
	}
}

/**
 *
 * @param {string} otherFormatName
 * @returns {boolean}
 */
function hasAlpha(otherFormatName)
{
	const { spawnSync } = require('child_process');
	let alphaCmd;
	try
	{
		let alphaProcess = spawnSync('magick', [
			path.resolve(otherFormatName),
			'-scale', '1x1!', '-format', "'%[fx:int(255*a+.5)]'", 'info:-'
		], {
			//  cwd: SOURCE_PATH,
			timeout: 3000,
		});
		alphaCmd = alphaProcess.stdout.toString('utf-8');
		//console.log(alphaCmd)
		//console.log(alphaProcess.stderr.toString('utf-8'))
	} catch(e)
	{
		if(e instanceof Error)
		{
			/** @type {any} */
			const k = e;
			console.error(e.message, (k.output ?? '').toString('utf-8').substr(0, 1000));
		}
	}

	//const MATCH = /false/ig
	const MATCH = /'0'|'255'/ig;
	return !Boolean(alphaCmd?.match(MATCH));
}


/**
 *
 * @param {string} filename
 * @returns {string[]}
 */
function layeredDir(filename)
{
	/** @type {string[]} */
	let list = [];

	for(let i = 0; i < BUILD_ORDER.length; i++)
	{
		let newPath = path.join(BUILD_DIRECTORY, BUILD_ORDER[i], filename);
		if(fs.existsSync(path.resolve(newPath))
			&& fs.statSync(path.resolve(newPath)).isDirectory())
		{
			list.push.apply(list, fs.readdirSync(path.resolve(newPath))
				.filter(file => file == GAME_DIRECTORY || file == 'vm'
					|| path.extname(file) == '.wasm' || path.extname(file) == '.qvm'));
		}
	}

	if(filename.startsWith(GAME_DIRECTORY))
	{
		let newPath = path.join(ASSETS_DIRECTORY, filename.substring(GAME_DIRECTORY.length));
		if(fs.existsSync(path.resolve(newPath))
			&& fs.statSync(path.resolve(newPath)).isDirectory())
		{
			list.push.apply(list, fs.readdirSync(path.resolve(newPath)));
		}

		if(filename.endsWith('.pk3dir/scripts'))
		{
			let maps = filename.substring(GAME_DIRECTORY.length, filename.indexOf('.pk3dir') + 7);
			let newPath = path.join(ASSETS_DIRECTORY, maps, 'maps');
			let bsps = fs.readdirSync(path.resolve(newPath))
				.filter(dir => dir.endsWith('.bsp'))
				.map(dir => dir.replace('.bsp', '.shader'));
			list.push.apply(list, bsps);
		}

		if(filename.includes('.pk3dir'))
		{
			let newPath = path.join(BUILD_DIRECTORY, filename.substring(GAME_DIRECTORY.length));
			if(fs.existsSync(path.resolve(newPath))
				&& fs.statSync(path.resolve(newPath)).isDirectory())
			{
				list.push.apply(list, fs.readdirSync(path.resolve(newPath)));
			}
		}
	}

	let newPath = path.join(WEB_DIRECTORY, filename);
	if(fs.existsSync(path.resolve(newPath))
		&& fs.statSync(path.resolve(newPath)).isDirectory())
	{
		list.push.apply(list, fs.readdirSync(path.resolve(newPath)));
	}

	if(filename == GAME_DIRECTORY)
	{
		list.push('version.json');
	}

	return list.reduce((/** @type {string[]} */ list, i) =>
	{
		if(i.endsWith('.pcx') || i.endsWith('.tga'))
		{
			if(!findFile(path.join(filename, i.replace(path.extname(i), '.png')))
				&& !findFile(path.join(filename, i.replace(path.extname(i), '.jpg'))))
			{
				list.push(i.replace(path.extname(i), '.png'));
				list.push(i.replace(path.extname(i), '.jpg'));
			}
		} else if(i.endsWith('.wav') || i.endsWith('.mp3'))
		{
			if(!findFile(path.join(filename, i.replace(path.extname(i), '.ogg'))))
			{
				list.push(i.replace(path.extname(i), '.ogg'));
			}
		} else
		{
			list.push(i);
		}
		return list;
	}, []).filter((p, i, l) => p[0] != '.' && l.indexOf(p) == i);
}


/**
 *
 * @param {string} localName
 * @param {string[]} list
 * @returns
 */
function makeDirectoryHtml(localName, list)
{
	let filelist = list.map(node =>
		`<li><a href="${path.join(localName, node)}">${node}</a></li>`).join('\n');
	let title = localName.endsWith('/') ? localName.substring(0, localName.length - 1) : localName;
	let breadcrumbs = ('/' + localName).split('/').filter((b, i) => i == 0 || b);
	let pathlinks = breadcrumbs.map((crumb, i) =>
		`<a href="${breadcrumbs.slice(0, i + 1).join('/')}">${i == 0 ? 'home' : crumb}</a>`).join(' / \n');
	return `
<!DOCTYPE html>
<html>
<head>
<title>${title}</title>
<style>ol{list-style:none;padding:0;}</style>
<base href="/" target="_self">
</head>
<body>
<h1>${pathlinks}</h1>
<ol>
${filelist}
</ol>
</body>
</html>
`;
}


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

const MATCH_PALETTE = /palette\s"(.*?)"\s([0-9]+(,[0-9]+)*)/ig;

/**
 *
 * @param {string} localName
 * @param {express.Response} response
 * @returns
 */
function makePaletteShader(localName, response)
{
	const { execSync } = require('child_process');
	const { findTypes, imageTypes } = require('./repack-whitelist');
	let pk3dir = localName;
	if(localName.startsWith(GAME_DIRECTORY))
	{
		pk3dir = localName.substring(GAME_DIRECTORY.length);
	}
	pk3dir = pk3dir.substr(0, pk3dir.indexOf('.pk3dir') + 7);
	let shaderPath = localName;
	if(localName.startsWith(GAME_DIRECTORY))
	{
		shaderPath = localName.substring(GAME_DIRECTORY.length);
	}
	if(!fs.existsSync(pk3dir))
	{
		console.log('wtf', pk3dir);
		pk3dir = path.join(ASSETS_DIRECTORY, pk3dir);
		shaderPath = path.join(ASSETS_DIRECTORY, shaderPath);
	}
	let images = findTypes(imageTypes, pk3dir);
	/** @type {Record<string, string>} */
	let palette = {};
	let existingPalette = '';
	if(fs.existsSync(shaderPath))
	{
		let m;
		existingPalette = fs.readFileSync(shaderPath).toString('utf-8');
		while((m = (MATCH_PALETTE).exec(existingPalette)) !== null)
		{
			palette[m[1]] = m[2];
		}
		existingPalette = existingPalette.replace(/palettes\/.*?\n*\{[\s\S]*?\}\n*/ig, '');
	}

	for(let i = 0; i < images.length; i++)
	{
		let newPath = path.join(GAME_DIRECTORY, images[i].substring(ASSETS_DIRECTORY.length));
		if(typeof palette[newPath] == 'undefined')
		{
			// get average image color for palette
			try
			{
				let colorCmd = execSync(`convert "${images[i]}" -resize 1x1\! -format "%[fx:int(255*a+.5)],%[fx:int(255*r+.5)],%[fx:int(255*g+.5)],%[fx:int(255*b+.5)]" info:-`, { stdio: 'pipe' }).toString('utf-8');
				palette[newPath] = colorCmd;
			} catch(e)
			{
				if(e instanceof Error)
				{
					/** @type {any} */
					let k = e;
					console.error(e.message, (k.output ?? '').toString('utf-8').substr(0, 1000));
				}
			}
		}
	}

	// save palette to shader file
	let imagePixels = Object.keys(palette)
		.map(k => `  palette "${k}" ${palette[k]}`).join('\n');
	existingPalette = `palettes\/${pk3dir.substr(1, pk3dir.length - 8)}\n{\n${imagePixels}\n}\n` + existingPalette;
	fs.writeFileSync(shaderPath, existingPalette);
	if(response)
		return response.send(existingPalette);
}


/** @type {import('zlib')} */
let zlib;
/** @type {import('mime').Mime} */
let mime;
/**
 *
 * @param {string} file
 * @param {express.Response} res
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

//let fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
/**
 *
 * @param {express.Request} request
 * @param {express.Response} response
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
	if(MENU_PATHS.includes(menuDir.toUpperCase()))
	{
		localName = localName.substring(0, localName.length - menuDir.length);
	}
	if(localName.endsWith('/'))
	{
		localName = localName.substring(0, localName.length - 1);
	}
	//if(localName.startsWith(GAME_DIRECTORY))
	//  localName = localName.substring(GAME_DIRECTORY.length)
	//if(localName[0] == '/')
	//  localName = localName.substring(1)

	// list palette images for pk3dirs
	if(localName.includes('.pk3dir/scripts/')
		&& localName.endsWith('.shader'))
	{
		let mapName = path.basename(localName.substring(0, localName.length - 7));
		let newPath = path.join(ASSETS_DIRECTORY,
			localName.substring(GAME_DIRECTORY.length), '../../maps/', mapName + '.bsp');
		if(fs.existsSync(newPath))
		{
			return makePaletteShader(localName, response);
		}
	}


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
	if((file = findAltImage(localName)))
	{
		let newPath = path.join(ASSETS_DIRECTORY, localName.substring(GAME_DIRECTORY.length));
		let alpha = hasAlpha(file);
		if((!alpha && localName.includes('.jpeg'))
			|| (alpha && localName.includes('.png')))
		{
			execSync(`magick "${file}" -auto-orient -strip -quality 50% "${path.resolve(newPath)}"`, { stdio: 'pipe' });
		}
		if(fs.existsSync(newPath))
		{
			if(request.headers['accept-encoding'])
			{
				return sendCompressed(path.resolve(file), response, request.headers['accept-encoding']);
			} else
			{
				return response.sendFile(path.resolve(newPath));
			}
		}
	}

	// if loading audio in a different format
	if((file = findAltAudio(localName)))
	{
		let newPath = path.join(ASSETS_DIRECTORY, localName.substring(GAME_DIRECTORY.length));
		if(file.includes('.mp3'))
		{
			execSync(`ffmpeg -i "${file}" -c:a libvorbis -q:a 4 "${path.resolve(newPath)}"`, { stdio: 'pipe' });
		} if(localName.includes('.ogg') || file.includes('.wav'))
		{
			execSync(`oggenc -q 7 --downmix --resample 11025 --quiet "${file}" -n "${path.resolve(newPath)}"`, { stdio: 'pipe' });
		}
		if(fs.existsSync(newPath))
		{
			if(request.headers['accept-encoding'])
			{
				return sendCompressed(path.resolve(file), response, request.headers['accept-encoding']);
			} else
			{
				return response.sendFile(path.resolve(newPath));
			}
		}
	}


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
/**
 *
 * @param {express.Request} req
 * @param {express.Response} res
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

/** @type {Record<string, string>} */
const customMimeTypes = {
	'.wasm': 'application/wasm',
	'.pk3': 'application/octet-stream',
	'.bsp': 'application/octet-stream',
};


let noFS = false;
let runServer = false;
let forwardIP = '';
let httpPort = 4004;
let masterPort = 27950;
console.log(process.argv);
for(let i = 0; i < process.argv.length; i++)
{
	let a = process.argv[i];
	if(path.resolve(a) === path.resolve(__filename))
	{
		console.log('Running server.');
		runServer = true;
	} else if(a == '--proxy-ip')
	{
		console.log('Forwarding ip address: ', process.argv[i + 1]);
		forwardIP = process.argv[i + 1];
		i++;
	} else if(a == '--no-fs')
	{
		console.log('Turning off file-system access.');
		noFS = true;
	} else if(a == '--http-port')
	{
		const was = httpPort;
		httpPort = parseInt(process.argv[i + 1]) ?? httpPort;
		console.log(`Changing HTTP port from default ${was} to ${httpPort}.`);
	} else if(a == '--master-port')
	{
		const was = masterPort;
		masterPort = parseInt(process.argv[i + 1]) ?? masterPort;
		console.log(`Changing Q3 Listing Server port from default ${was} to ${masterPort}.`);
	}
}


if(runServer)
{
	process.on('unhandledRejection', (reason, promise) =>
	{
		console.error('\x1b[31m[UNHANDLED REJECTION / 500]\x1b[0m', reason);
	});

	// Log uncaught synchronous exceptions before process exits
	process.on('uncaughtException', (err) =>
	{
		console.error('\x1b[31m[UNCAUGHT EXCEPTION / 500]\x1b[0m', err.stack || err);
	});
	/*
	const os = require("os");
	const cluster = require("cluster");

	cluster.schedulingPolicy = cluster.SCHED_RR;

	if (cluster.isPrimary) {
		const numCPUs = Math.min(os.cpus().length, 4); // Cap at 4 workers max for dev
		console.log(`[Master] Spawning ${numCPUs} concurrent server workers...`);

		for (let i = 0; i < numCPUs; i++) {
			cluster.fork();
		}

		cluster.on("exit", (worker) => {
			console.log(`[Master] Worker ${worker.process.pid} died. Restarting...`);
			cluster.fork();
		});
	} else {
	*/
	const WebSocketServer = require('ws').Server;
	const { Server } = require('./socks.server.js');
	const express = require('express');
	const app = express();
	const http = require('http');
	const master = require('./master.js');

	master(masterPort);

	app.enable('etag');
	app.set('etag', 'strong');

	// ==========================================
	// 1. REQUEST & RESPONSE LOGGER MIDDLEWARE
	// ==========================================
	app.use((req, res, next) =>
	{
		const start = Date.now();
		const pid = process.pid;

		// Intercept res.finish to capture status code after handling
		res.on('finish', () =>
		{
			const duration = Date.now() - start;
			const status = res.statusCode;

			// Color coding for standard console output
			let color = '\x1b[32m'; // Green (2xx/3xx)
			if(status >= 400 && status < 500) color = '\x1b[33m'; // Yellow (4xx)
			if(status >= 500) color = '\x1b[31m'; // Red (5xx)
			const reset = '\x1b[0m';

			console.log(
				`[Worker ${pid}] ${req.method} ${req.originalUrl || req.url} ${color}${status}${reset} - ${duration}ms`
			);
		});

		next();
	});

	// App Middlewares
	app.use(middleware);

	if(!noFS)
	{
		//app.use(removableStorageMiddleware);
		app.use(respondRequest);
	}

	// ==========================================
	// 2. EXPRESS 4-ARGUMENT ERROR HANDLER
	// ==========================================

	app.use(
		/**
		 * @param {Error | any} err
		 * @param {express.Request} req
		 * @param {express.Response} res
		 * @param {Function} next
		 */
		function (err, req, res, next)
		{
			const status = err.status || err.statusCode || 500;
			console.error(
				`[Worker ${process.pid}] \x1b[31m[ERROR ${status}]\x1b[0m ${req.method} ${req.originalUrl || req.url}:`,
				err.message || err
			);

			if(err.stack)
			{
				console.error(err.stack);
			}

			if(!res.headersSent)
			{
				res.status(status).json({
					error: true,
					status,
					message: err.message || 'Internal Server Error',
					path: req.originalUrl || req.url
				});
			}
		});

	let socks = new Server({ proxy: forwardIP });
	let httpServer = http.createServer(app);

	// Catch low-level HTTP server errors (e.g. EADDRINUSE)
	httpServer.on('error', (err) =>
	{
		console.error(`[Worker ${process.pid}] HTTP Server Error:`, err);
	});

	httpServer.listen(httpPort, console.log.bind(null, `[Worker ${process.pid}] Server is running on ${httpPort}`));

	let wss = new WebSocketServer({ server: httpServer });
	wss.on('connection', socks._onConnection.bind(socks));

	startFileWatcher();
	//}
} else
{
	console.log('Not running server. Exiting.');
}

module.exports = {
	writeVersionFile,
	respondRequest,
	makePaletteShader,
};
