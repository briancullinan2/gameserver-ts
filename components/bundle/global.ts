import type { BuildWindow } from "../bundle/make.d";

const buildSelf: BuildWindow = /** @type {any} */ (self as unknown as any);

export const path = {
	join: (...parts: string[]): string =>
	{
		return parts
			.map((part: string, index: number) =>
			{
				if(index > 0) return part.replace(/^\//, ''); // Strip leading slash
				return part.replace(/\/$/, ''); // Strip trailing slash
			})
			.filter((part: string) => part.length > 0)
			.join('/');
	},
	resolve: (...parts: string[]): string =>
	{
		let resolvedSegments: string[] = [];

		for(const part of parts)
		{
			if(!part) continue;

			// If a segment starts with '/', it acts as an absolute root reset
			if(part.startsWith('/'))
			{
				resolvedSegments = part.split('/');
			} else
			{
				resolvedSegments.push(...part.split('/'));
			}
		}

		// Normalize the accumulated stack (. and .. processing)
		const stack: string[] = [];
		for(const segment of resolvedSegments)
		{
			if(segment === '' || segment === '.')
			{
				continue;
			}
			if(segment === '..')
			{
				if(stack.length > 0)
				{
					stack.pop();
				}
				continue;
			}
			stack.push(segment);
		}

		// Reconstruct the path ensuring it behaves as an absolute result
		return '/' + stack.join('/');
	}
};

export const LONG_NAME = 'Game Server';
export const SHORT_NAME = '🎮🪙⚔️';
buildSelf.LONG_NAME = LONG_NAME;
buildSelf.SHORT_NAME = SHORT_NAME;

const COMPILE_PLATFORM = 'wasm';
const COMPILE_ARCH = 'js';

const GAME_PLATFORM = 'qvm';
const GAME_ARCH = 'bytecode';
buildSelf.GAME_PLATFORM = GAME_PLATFORM;
buildSelf.GAME_ARCH = GAME_ARCH;
buildSelf.COMPILE_PLATFORM = COMPILE_PLATFORM;
buildSelf.COMPILE_ARCH = COMPILE_ARCH;

export const config = {
	BUILD_CLIENT: 1,
	BUILD_SERVER: 1,
	USE_SDL: 1,
	USE_CURL: 1,
	USE_LOCAL_HEADERS: 0,
	USE_SYSTEM_JPEG: 0,
	USE_OGG_VORBIS: 1,
	USE_VULKAN: 0,
	USE_OPENGL: 0,
	USE_OPENGL2: 1,
	RENDERER_DEFAULT: "opengl2",
	CNAME: "quake3e",
	DNAME: "quake3e.ded",
	MOUNT_DIR: "code",
	BUILD_DIR: "build",
	BINEXT: `.${COMPILE_ARCH}.${COMPILE_PLATFORM}`,
	TEMPDIR: '/tmp',
	HOMEDIR: '/home',
	RUNBASE: '/base',
	MOD: 'baseq3a'
};
buildSelf.config = config;

export const dirs = {
	ENGINE_DEBUG: path.join(config.BUILD_DIR, `debug-${COMPILE_PLATFORM}-${COMPILE_ARCH}`),
	ENGINE_RELEASE: path.join(config.BUILD_DIR, `release-${COMPILE_PLATFORM}-${COMPILE_ARCH}`),

	GAME_DEBUG: path.join(config.BUILD_DIR, `debug-${GAME_PLATFORM}-${GAME_ARCH}`),
	GAME_RELEASE: path.join(config.BUILD_DIR, `release-${GAME_PLATFORM}-${GAME_ARCH}`),

	CGDIR: path.join(config.MOUNT_DIR, "cgame"),
	QADIR: path.join(config.MOUNT_DIR, "game"),
	UIDIR: path.join(config.MOUNT_DIR, "ui"),
	Q3UIDIR: path.join(config.MOUNT_DIR, "q3_ui"),

	CDIR: path.join(config.MOUNT_DIR, "client"),
	SDIR: path.join(config.MOUNT_DIR, "server"),
	CMDIR: path.join(config.MOUNT_DIR, "qcommon"),
	//R1DIR: path.join(config.MOUNT_DIR, "renderer"),
	R2DIR: path.join(config.MOUNT_DIR, "renderer2"),
	RCDIR: path.join(config.MOUNT_DIR, "renderercommon"),
	//RVDIR: path.join(config.MOUNT_DIR, "renderervk"),
	BLIBDIR: path.join(config.MOUNT_DIR, "botlib"),
	WASMDIR: path.join(config.MOUNT_DIR, "wasm"),
};
buildSelf.dirs = dirs;

const ENGINE_MEMORY_BASE = 48 * 1024 * 1024;
const UI_MEMORY_BASE = 32;
const CGAME_MEMORY_BASE = 16 * 1024 * 1024;
const GAME_MEMORY_BASE = 32 * 1024 * 1024;

buildSelf.path = path;
buildSelf.config = config;
buildSelf.dirs = dirs;

buildSelf.ENGINE_MEMORY_BASE = ENGINE_MEMORY_BASE;
buildSelf.UI_MEMORY_BASE = UI_MEMORY_BASE;
buildSelf.CGAME_MEMORY_BASE = CGAME_MEMORY_BASE;
buildSelf.GAME_MEMORY_BASE = GAME_MEMORY_BASE;

buildSelf.COMPILE_PLATFORM = COMPILE_PLATFORM;
buildSelf.COMPILE_ARCH = COMPILE_ARCH;
buildSelf.GAME_PLATFORM = GAME_PLATFORM;
buildSelf.GAME_ARCH = GAME_ARCH;

// 2. Safely capture or initialize the instance on window
const FSInstance = buildSelf.FS || { virtual: {} };

if(!buildSelf.FS)
{
	buildSelf.FS = FSInstance;
}

// 3. Export it cleanly for module usage
export const FS = FSInstance;

