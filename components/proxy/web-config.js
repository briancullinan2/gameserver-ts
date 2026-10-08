/// <reference types="node" />
// @ts-check

const path = require('path');

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

/** @type {Record<string, string>} */
const customMimeTypes = {
	'.wasm': 'application/wasm',
	'.pk3': 'application/octet-stream',
	'.bsp': 'application/octet-stream',
};

module.exports = {
	GAME_DIRECTORY,
	WEB_DIRECTORY,
	ASSETS_DIRECTORY,
	BUILD_DIRECTORY,
	ALLOWED_DIRECTORIES,
	BUILD_ORDER,
	MENU_PATHS,
	customMimeTypes
};
