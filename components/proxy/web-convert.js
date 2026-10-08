/// <reference types="node" />
// @ts-check

const fs = require('fs');
const path = require('path');
const Stream = require('stream');
const { findFile } = require('./web-layered');
const { GAME_DIRECTORY, ASSETS_DIRECTORY } = require('./web-config');

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


const MATCH_PALETTE = /palette\s"(.*?)"\s([0-9]+(,[0-9]+)*)/ig;

/**
 *
 * @param {string} localName
 * @param {import('express').Response} response
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
