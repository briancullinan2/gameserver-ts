// @ts-check

/** @type {import('./widget.d').TerminalCommandWindow} */
const commandSelf = /** @type {any} */ (self);

const LINES_TO_SAVE = 1000;

// Definitive Semantic Autocomplete Types
const ARG_TYPES = {
	FILE: 'file',          // Local file path validation/completion
	DATABASE: 'database',  // GitHub user/repo path pattern tracking
	STRING: 'string',      // Plain text argument
	NUMERIC: 'number'
};

/**
 * @type {import("./commands-complete").CommandSchema}
 */
const COMMAND_SCHEMA = {
	help: {
		execute: help,
		description: "Display structured manual lookups for all available engine commands.",
		args: [{ name: "command", type: ARG_TYPES.STRING, description: "Target command manual to profile" }],
		flags: {},
		demos: [
			{ cmd: "help", desc: "List all global system commands and inline operational manuals" },
			{ cmd: "help build", desc: "Profile parameters, targets, and modes for the build compiler pipeline" }
		]
	},
	hello: {
		execute: hello,
		description: "Greet the currently authenticated cloud shell profile or custom user identifier.",
		args: [{ name: "name", type: ARG_TYPES.STRING, description: "Fallback custom display moniker if profile is offline" }],
		flags: {},
		demos: [
			{ cmd: "hello", desc: "Query the active gcloud profile identity and print a customized terminal greeting" },
			{ cmd: "hello Megamind", desc: "Execute an explicit string greet bypass to the terminal stream output" }
		]
	},
	error: {
		execute: error,
		description: "Generate an application error to test editing application files.",
		args: [],
		flags: {},
		demos: [
			{ cmd: "error", desc: "Trigger a synthetic runtime exception to verify error handling and log capture when modifying application files" }
		]
	},
	status: {
		execute: commandSelf.statusCommand,
		description: "Show working file mutations, additions, or deletions against the remote repository branch.",
		args: [
			{ name: "repo_path", type: ARG_TYPES.DATABASE, description: "Target repository identifier string (Defaults to engine context)" }
		],
		flags: {},
		demos: [
			{ cmd: "status", desc: "Profile unstaged differences for active development space" },
			{ cmd: "status briancullinan2/quake3e-wasm", desc: "Check localized changes inside a specific module" }
		]
	},
	push: {
		execute: commandSelf.push,
		description: "Pack up staged modifications and atomically advance the remote head pointer via a Git commit.",
		args: [
			{ name: "message", type: ARG_TYPES.STRING, description: "Descriptive message log for the new commit point" },
			{ name: "repo_path", type: ARG_TYPES.DATABASE, description: "Optional target repository override sequence" }
		],
		flags: {},
		demos: [
			{ cmd: "push 'Fix vector snap math calculations inside bg_misc.c'", desc: "Commit mutations to remote repository" }
		]
	},
	find: {
		execute: commandSelf.find,
		description: "Execute a workspace-wide structural glob pattern or deep content text match via background workers.",
		args: [{ name: "query", type: ARG_TYPES.STRING, description: "Text string or glob pattern to locate across repositories" }],
		flags: {
			"-c": "Force strict case-sensitive parameter validation profiling rules"
		},
		demos: [
			{ cmd: "find baseq3/*.wasm", desc: "Locate WebAssembly side modules inside your baseq3 layout" },
			{ cmd: "find trap_SnapVector", desc: "Scan all asset repository code spaces for active occurrences of a code symbol" }
		]
	},
	clear: {
		execute: clear,
		description: "Clear active terminal screen scrollback history layers.",
		args: [],
		flags: {},
		demos: [{ cmd: "clear", desc: "Flush terminal screen scrollback" }]
	},
	reset: {
		execute: reset,
		description: "Hard reset terminal terminal display state engine.",
		args: [],
		flags: {},
		demos: [{ cmd: "reset", desc: "Reinitialize active graphic canvas streams and terminals" }]
	},
	ls: {
		execute: commandSelf.ls,
		description: "List workspace data entries within the current execution path.",
		args: [],
		flags: {
			'-R': { description: "Recursively traverse matching sub-paths" },
			'-h': { description: "Render data content metrics using human-readable layouts" },
			'-1': { description: "Force single column flat stream list format output" }
		},
		demos: [
			{ cmd: "ls", desc: "List files within the current active workspace directory" },
			{ cmd: "ls -R", desc: "Recursively print all sub-directories and downstream files" },
			{ cmd: "ls -h", desc: "List files showing size metrics using human-readable formats" },
			{ cmd: "ls -1", desc: "Force flat single column layout stream processing list" }
		]
	},
	build: {
		execute: commandSelf.buildCommand,
		prereqs: ['build'],
		description: "Execute compilation procedures across targeted project modules.",
		args: [
			{
				name: "mode",
				type: ['release', 'debug', 'tools', 'qvms', 'client', 'engine', 'server', 'shaders', 'stringify', 'q3lcc', 'q3rcc', 'q3asm', 'lburg', 'game', 'cgame', 'ui', 'q3_ui'],
				description: "Target build execution configuration profile"
			},
			{ name: "target_db", type: ARG_TYPES.DATABASE, description: "Override execution repository target" }
		],
		flags: {},
		demos: [
			{ cmd: "build client", desc: "Compile the web front-end engine client package components" },
			{ cmd: "build tools", desc: "Compile toolchain assets including lcc, rcc, and q3asm engines" },
			{ cmd: "build qvms", desc: "Build game sandbox files: qagame, cgame, and user interface modules" },
			{ cmd: "build debug briancullinan2/quedit", desc: "Execute target architecture debug compilation over explicit database workspace" }
		]
	},
	remove: {
		execute: commandSelf.remove,
		description: "Purge targeted structural documents from persistent storage matrices.",
		args: [
			{ name: "filename", type: ARG_TYPES.FILE, description: "File path targeted for deletion" }
		],
		flags: {},
		demos: [
			{ cmd: "remove code/game/g_main.c", desc: "Purge target gameplay initialization file from cache layers" }
		]
	},
	open: {
		execute: commandSelf.openCommand,
		prereqs: ['editor'],
		description: "Load a specified document directly into the active editing layout space.",
		args: [
			{ name: "filename", type: ARG_TYPES.FILE, description: "Target file path to parse" },
			{ name: "target_db", type: ARG_TYPES.DATABASE, description: "Repository resource source point" }
		],
		flags: {},
		demos: [
			{ cmd: "open src/dagcheck.md", desc: "Open code generator structural documentation file" },
			{ cmd: "open code/client/cl_main.c briancullinan2/quedit", desc: "Load client core engine file from an explicit system database" }
		]
	},
	compile: {
		execute: commandSelf.compileWorker,
		prereqs: ['build'],
		description: "Trigger compiler pipelines on target code assets.",
		args: [
			{ name: "filename", type: ARG_TYPES.FILE, description: "Source document targeted for evaluation" },
			{ name: "target_db", type: ARG_TYPES.DATABASE, description: "Target environment database repository context" }
		],
		flags: {},
		demos: [
			{ cmd: "compile code/game/bg_lib.c", desc: "Run background compatibility library code block processing" }
		]
	},
	run: {
		execute: commandSelf.runWorker,
		prereqs: ['build'],
		description: "Invoke binary runtime tasks or specialized compiler utility tools.",
		args: [
			{ name: "tool", type: ARG_TYPES.FILE, description: "WASM engine target binary element filename" }
		],
		flags: {},
		demos: [
			{ cmd: "run quake3e.wasm", desc: "Instantiate primary Quake 3 WASM engine cluster execution" },
			{ cmd: "run q3asm.js.wasm", desc: "Invoke web assembly runtime wrapper context instance directly" }
		]
	},
	lburg: {
		execute: commandSelf.lburg,
		prereqs: ['build'],
		description: "Run code generator bottom-up rewrite system compilation tools.",
		args: [
			{ name: "input_md", type: ARG_TYPES.FILE, description: "DAG description source ruleset" },
			{ name: "output_c", type: ARG_TYPES.FILE, description: "Output C source translation destination layout" }
		],
		flags: {},
		demos: [
			{ cmd: "lburg src/dagcheck.md src/dagcheck.c", desc: "Generate low-level system matrix parse definitions" }
		]
	},
	clone: {
		execute: commandSelf.clone,
		description: "Clone external structures down into local indexed DB instances.",
		args: [
			{ name: "repo_path", type: ARG_TYPES.DATABASE, description: "Target remote owner/repository pathway" },
			{ name: "branch", type: ARG_TYPES.STRING, description: "Specific repository branch tag context" }
		],
		flags: {},
		demos: [
			{ cmd: "clone briancullinan2/quedit", desc: "Clone environment profile default production structures" },
			{ cmd: "clone id-Software/Quake-III-Arena main", desc: "Pull explicit code branches from target historical repository tracking lists" }
		]
	},
	kill: {
		execute: commandSelf.kill,
		description: "Terminate all running workers or low-level application processes immediately.",
		args: [],
		flags: {},
		demos: [{ cmd: "kill", desc: "Force stop all active asynchronous layout thread routines" }]
	},
	header: {
		execute: commandSelf.header,
		description: "Upload header files to the background worker before trying to compile code that includes them.",
		args: [
			{ name: "filename", type: ARG_TYPES.FILE, description: "Target include header file structure context" }
		],
		flags: {},
		demos: [
			{ cmd: "header code/game/g_local.h", desc: "Profile include links and structural offsets for target header definitions" }
		]
	},
	link: {
		execute: commandSelf.link,
		prereqs: ['build'],
		description: "Link compiled sandbox application object segments or virtual image fragments into unified module payloads.",
		args: [
			{
				name: "mode",
				type: ['release', 'debug', 'tools', 'qvms', 'client', 'engine', 'server', 'shaders', 'stringify', 'q3lcc', 'q3rcc', 'q3asm', 'lburg', 'game', 'cgame', 'ui', 'q3_ui'],
				description: "Target build execution configuration profile"
			},
			{ name: "target_db", type: ARG_TYPES.DATABASE, description: "Override execution repository target" }
		],
		flags: {},
		demos: [
			{ cmd: "link game", desc: "Skip any already built objects and run lld.wasm on code/game files." }
		]
	},
	load: {
		execute: loadCommand,
		description: "Load a specific predefined module into the app, bypassing the laziness of the menus.",
		args: [
			{
				name: "module",
				type: ['terminal', 'terminal-container', 'editor', 'build', 'quake3e', 'q3', 'engine', 'client', 'audio', 'viewport-frame', 'toji', 'paint', 'nunu', 'audio-editor', 'map-editor', 'map-loader'],
				description: "Load the specified module by name"
			}
		],
		flags: {},
		demos: [
			{ cmd: "load editor", desc: "Immediately loads the " }
		]
	},
	clang: {
		execute: commandSelf.clang,
		prereqs: ['build'],
		description: "Direct compiler frontend interface for raw wasm32-wasi compilation.",
		args: [
			{ name: "source_file", type: ARG_TYPES.FILE, description: "Source document (.c, .cpp) to compile" }
		],
		flags: {
			'-cc1': { description: "Invoke core compiler frontend directly, bypassing standard driver wrappers" },
			'-emit-obj': { description: "Force emit compiled binary relocatable object code (.o file matrix)" },
			'-triple=wasm32-wasi': { description: "Target core WASI interface platform architecture footprint" },
			'-fcolor-diagnostics': { description: "Enable ANSI color mapping codes inside IDE compiler log outputs" },
			'-ferror-limit': { description: "Truncate macro expansion/diagnostic error reporting logs [Default: 100]" },
			'-O0': { description: "Disable optimization passes for rapid debugging, explicit stack tracing, and rapid generation" },
			'-O3': { description: "Enable aggressive compiler optimization passes for maximum execution performance limits" },
			'-fno-rtti': { description: "Disable C++ Run-Time Type Information structures to minimize output sizing footprints" },
			'-fno-threadsafe-statics': { description: "Omit synchronization locks around local static initializations inside single-threaded loops" },
			'-D__WASM__=1': { description: "Inject explicit target macro conditioning parameters into preprocessor environments" },
			'-I': { description: "Append a specific directory tracking path directly into system header include matrices" }
		},
		demos: [
			{ cmd: "clang -cc1 -emit-obj -triple wasm32-wasi code/game/g_main.c", desc: "Compile raw engine gameplay core down to an unlinked relocatable object file" },
			{ cmd: "clang -cc1 -O3 -I/code/qcommon code/client/cl_main.c", desc: "Execute an optimized parsing iteration over target client source trees" }
		]
	},
	wasm: {
		execute: commandSelf.wasm,
		prereqs: ['build'],
		description: "Direct LLVM static linker (wasm-ld) and diagnostic utility wrapper engine.",
		args: [
			{ name: "object_files", type: ARG_TYPES.FILE, description: "Compiled relocatable object components (.o) to link" }
		],
		flags: {
			'--no-entry': { description: "Allow linking compilation blobs lacking a traditional primary main() entry sequence" },
			'--export-all': { description: "Force expose all internal compilation symbols out directly into the browser's JS loop" },
			'--export': { description: "Explicitly append a named function/symbol structure into the module export tracking array" },
			'--allow-undefined': { description: "Allow compilation maps to contain dangling external symbol hooks to link at runtime" },
			'--import-memory': { description: "Instruct module to ingest WebAssembly.Memory provided explicitly by browser host script wrappers" },
			'--initial-memory': { description: "Set native initialization footprint requirements for linear allocation arenas [Bytes]" },
			'--max-memory': { description: "Set hard-boundary thresholds for memory growth before triggering buffer expansion drops" },
			'-o': { description: "Define output path target destination filename for finished binary payload (.wasm)" }
		},
		demos: [
			{ cmd: "wasm-ld --no-entry --export-all -o quake3e.wasm code/game/g_main.o code/game/bg_lib.o", desc: "Link independent local runtime object fragments into a single executable system file" },
			{ cmd: "wasm-ld --import-memory --initial-memory=67108864 -o q3asm.wasm code/tools/asm.o", desc: "Link assembly generator mapping tool with a fixed 64MB baseline allocation pool" }
		]
	},
	// ==========================================
	// Symbolic Alias/Redirect Mapping Matrix
	// ==========================================
	rm: { alias: "remove" },
	manual: { alias: "help" },
	mount: { alias: "clone" },
	delete: { alias: "remove" },
	make: { alias: "build" },
	edit: { alias: "open" },
	lcc: { alias: "clang" },
	rcc: { alias: "clang" },
	ld: { alias: "wasm" },
	terminal: { alias: "load" },
	editor: { alias: "load" },
	q3: { alias: "load" },
	toji: { alias: "load" },
	paint: { alias: "load" },
	engine: { alias: "load" },
	client: { alias: "load" },
	quake3e: { alias: "load" },
	cc1: { alias: "clang" },
	as: { alias: "clang" },
	cpp: { alias: "clang" },
	'clang++': { alias: "clang" },
	'wasm-ld': { alias: "wasm" },
	'lld': { alias: "wasm" },
	terminate: { alias: "kill" },
	stop: { alias: "kill" },
	start: { alias: "run" },
};


commandSelf.COMMAND_SCHEMA = COMMAND_SCHEMA;


/**
 *
 * @param {string} targetCommand
 * @param {string[] | undefined} argv
 * @returns
 */
function writeCommandHelp(targetCommand, argv = void 0)
{
	if(!targetCommand) return;

	const schema = COMMAND_SCHEMA[targetCommand];
	if(!schema)
	{
		commandSelf.terminalWrite?.(`\x1b[38;5;203m[HELP ERROR]\x1b[0m Unknown command entity descriptor: "${targetCommand}"\n\r`);
		return;
	}

	// Handle Symbolic Redirection Hooks instantly
	if(schema.alias)
	{
		commandSelf.terminalWrite?.(`\x1b[38;5;221m[ALIAS]\x1b[0m Command \x1b[1m"${targetCommand}"\x1b[0m is a symbolic link to: \x1b[38;5;118m${schema.alias}\x1b[0m\n\r`);
		commandSelf.terminalWrite?.(`Execute "help ${schema.alias}" to view operational engine constraints.\n\r`);
		return;
	}

	commandSelf.terminalWrite?.(`\n\r\x1b[1;38;5;33mMANUAL LOOKUP: ${targetCommand.toUpperCase()}\x1b[0m\n\r`);
	commandSelf.terminalWrite?.(`\x1b[4mDescription:\x1b[0m ${schema.description}\n\r\n\r`);

	// Render Arguments and Typings
	if(schema.args && schema.args.length > 0)
	{
		commandSelf.terminalWrite?.(`\x1b[4mArguments:\x1b[0m\n\r`);
		schema.args.forEach((arg, index) =>
		{
			let typeString = '';
			if(Array.isArray(arg.type))
			{
				typeString = `[enum: ${arg.type.join('|')}]`;
			} else
			{
				typeString = `<${arg.type}>`;
			}
			commandSelf.terminalWrite?.(`  argv[${index}] : ${arg.name.padEnd(14)} \x1b[38;5;214m${typeString.padEnd(30)}\x1b[0m # ${arg.description}\n\r`);
		});
		commandSelf.terminalWrite?.(`\n\r`);
	}

	// Render Compilation and Runtime Flags
	const flagKeys = Object.keys(schema.flags || []);
	if(flagKeys.length > 0)
	{
		commandSelf.terminalWrite?.(`\x1b[4mAvailable Flags:\x1b[0m\n\r`);
		flagKeys.forEach(flag =>
		{
			commandSelf.terminalWrite?.(`  ${flag.padEnd(10)} : ${typeof schema.flags?.[flag] === 'string' ? schema.flags?.[flag] : schema.flags?.[flag].description}\n\r`);
		});
		commandSelf.terminalWrite?.(`\n\r`);
	}

	if(schema.demos && schema.demos.length > 0)
	{
		commandSelf.terminalWrite?.(`\x1b[4mSample Execution Demos (Interactive):\x1b[0m\n\r`);
		schema.demos.forEach(demo =>
		{
			// Bright Turquoise underlines on the actual target command sequence lines
			// making them instantly targetable for stage two processing maps
			commandSelf.terminalWrite?.(`\x1b[1;38;5;81m${demo.cmd.padEnd(50)}\x1b[0m \x1b[38;5;244m# ${demo.desc}\x1b[0m\n\r`);
		});
	}

}

/**
 *
 * @param {string[]} argv
 * @param {string} database
 * @param {string} commandName
 * @returns
 */
async function loadCommand(argv, database, commandName)
{

	let moduleToLoad = argv[0] || commandName;

	if(moduleToLoad === 'audio' || moduleToLoad === 'audio-editor')
	{
		moduleToLoad = 'audio-editor';
	}
	if(moduleToLoad === 'client' || moduleToLoad === 'engine'
		|| moduleToLoad === 'quake3e' || moduleToLoad === 'toji'
		|| moduleToLoad === 'map-loader' || moduleToLoad === 'q3')
	{
		moduleToLoad = 'viewport-frame';
	}
	if(moduleToLoad === 'terminal' || moduleToLoad === 'terminal-container')
	{
		moduleToLoad = 'terminal-container';
	}

	if(moduleToLoad === 'build')
	{
		for(let src of commandSelf.BUILD_SCRIPTS ?? [])
		{
			await commandSelf.loadScript?.(src);
		}
	} else if(!commandSelf.MODULE_REGISTRY?.[moduleToLoad]
		&& !commandSelf.TOOLS_REGISTRY?.[moduleToLoad]
	)
	{
		console.log('Invalid module specified: ' + argv[0]);
		console.log('Valid options:');
		writeCommandHelp('load');
		return;
	}

	await commandSelf.triggerPanelRoute?.(moduleToLoad, commandSelf.mainDock, true);

}


/**
 *
 * @param {string[]} argv
 * @param {string} database
 * @param {string} commandName
 * @param {import('@xterm/xterm').Terminal} term
 */
async function help(argv, database, commandName, term)
{
	const targetCommand = argv[0];

	// Scenario A: Render deep metrics for an explicit, single requested command target
	if(targetCommand)
	{
		writeCommandHelp(targetCommand);
		if(COMMAND_SCHEMA[targetCommand] && COMMAND_SCHEMA[targetCommand].alias)
		{
			writeCommandHelp(COMMAND_SCHEMA[targetCommand].alias);
		}
		return;
	}

	// Scenario B: Global lookup list pass (Default plain "help" execution context)
	commandSelf.terminalWrite?.(`\n\r\x1b[1;38;5;118m=== AVAILABLE SYSTEM COMMANDS ===\x1b[0m\n\r`);

	// Sort keys to maintain a clean layout presentation
	const keys = Object.keys(COMMAND_SCHEMA).sort();

	// Compute padding alignments
	const maxKeyLen = Math.max(...keys.map(k => k.length), 10);

	for(const key of keys)
	{
		const item = COMMAND_SCHEMA[key];
		const keyNameDisplay = key.padEnd(maxKeyLen + 2);

		if(item.alias)
		{
			// Render basic alias linkage markers concisely
			commandSelf.terminalWrite?.(`  \x1b[38;5;244m${keyNameDisplay} -> alias to [${item.alias}]\x1b[0m\n\r`);
		} else
		{
			// Render active descriptions
			commandSelf.terminalWrite?.(`  \x1b[1;38;5;45m${keyNameDisplay}\x1b[0m : ${item.description}\n\r`);
		}
	}
	for(const key of keys)
	{
		if(!COMMAND_SCHEMA[key].alias)
		{
			writeCommandHelp(key);
			// Boundary line divider separating operational tools
			commandSelf.terminalWrite?.(`\x1b[38;5;238m${'-'.repeat(term.cols || 80)}\x1b[0m\n\r`);
		}
	}

	commandSelf.terminalWrite?.(`\n\rRun "help <command>" to query explicit option arguments and value types.\n\r`);
}


/**
 *
 * @param {string} input
 * @returns {string[]}
 */
function tokenize(input)
{
	// Regex matches words, or strings inside single/double quotes
	const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
	const tokens = [];
	let match;

	while((match = regex.exec(input)) !== null)
	{
		// match[1] is double-quoted content, match[2] is single-quoted
		// match[0] is the unquoted word
		tokens.push(match[1] || match[2] || match[0]);
	}
	return tokens;
}



commandSelf.CWD = '';
commandSelf.runningCommand = false;
commandSelf.detachedConsole = false;

/**
 *
 * @param {string} input
 * @param {import('@xterm/xterm').Terminal} term
 * @returns
 */
async function handleCommand(input, term)
{
	const database = commandSelf.RepositoryToolbar?.owner?.value + '/' + commandSelf.RepositoryToolbar?.repository?.value;
	const tokens = tokenize(input.trim());

	if(commandSelf.api)
	{
		commandSelf.api.configuration = commandSelf.SettingsToolbar?.configuration?.value === 'debug' ? 'debug' : 'release';
	}

	if(tokens.length === 0) return;

	if(!commandSelf.runningCommand)
	{
		commandSelf.TERMINATE = false;
		commandSelf.alreadyWroteDetached = false;
	}

	const [commandName, ...args] = tokens;

	let resolvedCommandKey = commandName;
	const schemaMatch = COMMAND_SCHEMA[commandName];

	if(schemaMatch && schemaMatch.alias)
	{
		resolvedCommandKey = schemaMatch.alias;
	}

	const targetExecutionRoute = COMMAND_SCHEMA[resolvedCommandKey]?.execute;

	if(targetExecutionRoute)
	{
		commandSelf.runningCommand = true;

		if(schemaMatch && schemaMatch.prereqs)
		{
			for(let importFirst of schemaMatch.prereqs)
			{
				if(commandSelf.MODULE_REGISTRY?.[importFirst])
				{
					await commandSelf.triggerPanelRoute?.(importFirst, commandSelf.mainDock, true);
				} else if(importFirst === 'build')
				{
					for(let src of commandSelf.BUILD_SCRIPTS ?? [])
					{
						await commandSelf.loadScript?.(src);
					}
				}
			}
		}

		try
		{
			await targetExecutionRoute(args, database, commandName, term);
		} catch(execError)
		{
			if(typeof commandSelf.originalConsole !== 'undefined')
				commandSelf.originalConsole.error(execError);
			console.error(`Failed executing: ${resolvedCommandKey}`, execError);
		}
	} else
	{
		commandSelf.terminalWrite?.(`Command not found: ${commandName}\n\r`);
	}

	// TODO: undetach the console by reporting "done" from the worker
	if(!commandSelf.detachedConsole)
	{
		commandSelf.runningCommand = false;
		//writePrompt() stop fucking writing this here and look at case '\r': // Enter / Return
	}

}


commandSelf.handleCommand = handleCommand;


/**
 *
 * @param {string[]} argv
 */
async function hello(argv)
{
	const name = argv[0] || 'User';
	let user = (await commandSelf.getAuthenticatedUser?.())?.login;
	commandSelf.terminalWrite?.(`Hello, ${user || name}!\n\r`);
}


/**
 *
 * @param {string[]} argv
 */
async function error(argv)
{
	throw new Error('test');
}


/**
 *
 * @param {string[]} argv
 * @param {string} database
 * @param {string} commandName
 * @param {import('@xterm/xterm').Terminal} term
 */
function reset(argv, database, commandName, term)
{
	term.reset();
}

/**
 *
 * @param {string[]} argv
 * @param {string} database
 * @param {string} commandName
 * @param {import('@xterm/xterm').Terminal} term
 */
function clear(argv, database, commandName, term)
{
	term.clear();
}


