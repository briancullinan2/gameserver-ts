
/// <reference types="node" />
// @ts-check

const fs = require('fs');
const path = require('path');
const Stream = require('stream');
const { BUILD_ORDER, BUILD_DIRECTORY, ASSETS_DIRECTORY, GAME_DIRECTORY, WEB_DIRECTORY } = require('./web-config');

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



module.exports = {
	findFile,
	makeDirectoryHtml,
	layeredDir
};

