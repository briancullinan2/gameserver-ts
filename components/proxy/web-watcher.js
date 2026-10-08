/// <reference types="node" />
// @ts-check

const fs = require('fs');
const path = require('path');
const Stream = require('stream');

const { ASSETS_DIRECTORY } = require("./web-config");
const middleware = require('./web-middle');


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
		middleware.latestMtime = new Date();
	} else
	{
		let newMtime = fs.statSync(path.join(ASSETS_DIRECTORY, prefix, filename)).mtime;
		if(newMtime > middleware.latestMtime)
		{
			middleware.latestMtime = newMtime;
		}
	}
	middleware.writeVersionFile(middleware.latestMtime);
}


function startFileWatcher()
{
	// TODO: enable file watchers in live reload mode
	//for(let i = 0; i < directories.length; i++) {
	//  fs.watch(path.join(ASSETS_DIRECTORY, directories[i]),
	//    fileChanged.bind(null, directories[i]))
	//}

}

module.exports = {
	fileChanged,
	startFileWatcher
};
