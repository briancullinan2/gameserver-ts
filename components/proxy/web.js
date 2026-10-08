/// <reference types="node" />
// @ts-check

const fs = require('fs');
const path = require('path');
const Stream = require('stream');


function oldStartup()
{
	// process.on('unhandledRejection', (reason, promise) =>
	// {
	// 	console.error('\x1b[31m[UNHANDLED REJECTION / 500]\x1b[0m', reason);
	// });

	// // Log uncaught synchronous exceptions before process exits
	// process.on('uncaughtException', (err) =>
	// {
	// 	console.error('\x1b[31m[UNCAUGHT EXCEPTION / 500]\x1b[0m', err.stack || err);
	// });
	// /*
	// const os = require("os");
	// const cluster = require("cluster");

	// cluster.schedulingPolicy = cluster.SCHED_RR;

	// if (cluster.isPrimary) {
	// 	const numCPUs = Math.min(os.cpus().length, 4); // Cap at 4 workers max for dev
	// 	console.log(`[Master] Spawning ${numCPUs} concurrent server workers...`);

	// 	for (let i = 0; i < numCPUs; i++) {
	// 		cluster.fork();
	// 	}

	// 	cluster.on("exit", (worker) => {
	// 		console.log(`[Master] Worker ${worker.process.pid} died. Restarting...`);
	// 		cluster.fork();
	// 	});
	// } else {
	// */
	const WebSocketServer = require('ws').Server;
	const { Server } = require('./socks.server.js');
	const express = require('express');
	const app = express();
	const http = require('http');
	const master = require('./master.js');
	const middleware = require('./web-middle.js');
	const { startFileWatcher } = require('./web-watcher.js');

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
	app.use(middleware.middleware);

	if(!noFS)
	{
		//app.use(removableStorageMiddleware);
		app.use(middleware.respondRequest);
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
}



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
	require('./web-workers');
} else
{
	console.log('Not running server. Exiting.');
}

module.exports = {
	oldStartup,
};
