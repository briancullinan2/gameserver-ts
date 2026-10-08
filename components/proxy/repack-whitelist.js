/// <reference types="node" />
// @ts-check

let path = require('path');
let fs = require('fs');

let imageTypes = [
	'.png',
	'.jpg',
	'.jpeg',
	'.tga',
	'.gif',
	'.pcx',
	'.webp',
	'.hdr',
	'.dds',
];

let audioTypes = [
	'.opus',
	'.wav',
	'.mp3',
	'.ogg',
];

let sourceTypes = [
	'.c', // these can be compiled in game to run bot AI
	'.h',
	'.map',
	'.scc',
];

let fileTypes = [
	'.roq',
	'.cfg',
	'.qvm',
	'.bot',
	'.txt',
	'.bsp',
	'.aas',
	'.md3',
	'.md5',
	'.iqm',
	'.mdr',
	'.log',
	'.shader',
	'.crosshair',
	'.skin',
	'.pk3',
	'.font',
	'.config',
	'.menu',
	'.defi', // CPMA game mode definition
	'.arena', // map based game mode definition
];

let knownDirs = [
	'scripts',
	'botfiles',
	'fonts',
	'gfx',
	'hud',
	'icons',
	'include',
	'menu',
	'models',
	'music',
	'powerups',  // powerup shaders
	'sprites',
	'sound',
	'ui',
	'maps',
	'videos',
	'textures',
];

// minimatch/globs
let whitelist = {
	'baseq3': [
		'**/+(sarge|major)/**',
		'**/player/*',
		'**/player/footsteps/*',
		'**/weapons2/+(machinegun|gauntlet)/**',
		'**/weaphits/**',
		'**/scripts/*.shader',
	],
	'missionpack': [
		'**/+(james|janet|sarge)/**',
		'**/player/*',
		'**/player/footsteps/*',
		'**/weapons2/+(machinegun|gauntlet)/**',
		'**/weaphits/**',
		'**/scripts/*.shader',
		'**/ui/assets/**',
	],
	'baseoa': [
		'**/+(sarge|major)/**',
		'**/player/*',
		'**/player/footsteps/*',
		'**/weapons2/+(machinegun|gauntlet)/**',
		'**/weaphits/**',
		'**/scripts/*.shader',
	],
	'baseq3r': [
		'**/+(player|players)/sidepipe/**',
		'**/+(player|players)/heads/doom*',
		'**/+(player|players)/plates/**',
		'**/+(player|players)/wheels/*cobra*',
		'**/player/*',
		'**/player/footsteps/*',
		'**/weaphits/**',
		'**/scripts/*.shader',
	],
	'q3ut4': [
		'**/+(athena)/**',
		'**/player/*',
		'**/player/footsteps/*',
		'**/weapons2/+(handskins)/**',
		'**/weaphits/**',
		'**/scripts/*.shader',
	],
	'threewave': []
};

let entities = [
	'*lightmap',
	'ammo_bfg',
	'ammo_bullets',
	'ammo_cells',
	'ammo_grenades',
	'ammo_lightning',
	'ammo_rockets',
	'ammo_shells',
	'ammo_slugs',
	'func_bobbing',
	'func_button',
	'func_door',
	'func_plat',
	'func_rotating',
	'func_static',
	'func_timer',
	'func_train',
	'holdable_medkit',
	'holdable_teleporter',
	'info_camp',
	'info_intermission',
	'info_notnull',
	'info_null',
	'info_player_deathmatch',
	'info_player_intermission',
	'info_player_start',
	'info_spectator_start',
	'item_armor_body',
	'item_armor_combat',
	'item_armor_shard',
	'item_botroam',
	'item_enviro',
	'item_flight',
	'item_haste',
	'item_health',
	'item_health_large',
	'item_health_mega',
	'item_health_small',
	'item_invis',
	'item_quad',
	'item_regen',
	'light',
	'misc_model',
	'misc_portal_camera',
	'misc_portal_surface',
	'misc_teleporter_dest',
	'path_corner',
	'shooter_grenade',
	'shooter_plasma',
	'shooter_rocket',
	'trigger_always',
	'target_delay',
	'target_give',
	'target_kill',
	'target_location',
	'target_position',
	'target_print',
	'target_push',
	'target_relay',
	'target_remove_powerups',
	'target_speaker',
	'target_teleporter',
	'team_CTF_blueflag',
	'team_CTF_blueplayer',
	'team_CTF_bluespawn',
	'team_CTF_redflag',
	'team_CTF_redplayer',
	'team_CTF_redspawn',
	'trigger_hurt',
	'trigger_multiple',
	'trigger_push',
	'trigger_teleport',
	'weapon_bfg',
	'weapon_grenadelauncher',
	'weapon_lightning',
	'weapon_machinegun',
	'weapon_plasmagun',
	'weapon_railgun',
	'weapon_rocketlauncher',
	'weapon_shotgun',
	'worldspawn'
].filter((a, i, arr) => arr.indexOf(a) === i);
entities.sort();
console.log(entities);

/**
 *
 * @param {string[]} types
 * @param {string} project
 * @returns
 */
function findTypes(types, project)
{
	if(Array.isArray(types)) types = `*+(${types.join('|')})`;
	if(fs.existsSync(project))
	{
		return require('glob').sync(types, { nocase: true, cwd: project, matchBase: true })
			.map(f => path.join(project, f));
	} else if(Array.isArray(project))
	{
		return project.filter(require('minimatch').filter(types, { nocase: true, matchBase: true }));
	} else
	{
		throw new Error(`Don't know what to do with ${project}`);
	}
}

module.exports = {
	knownDirs,
	fileTypes,
	sourceTypes,
	audioTypes,
	imageTypes,
	findTypes,
	whitelist,
	entities,
	allTypes: [imageTypes, audioTypes, sourceTypes, fileTypes].flat(1)
};
