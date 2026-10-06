
import { SettingConfig } from "./settings";

// Automatically compiled workspace settings cache pass

export const IMPORT_SETTINGS: Record<string, Record<string, SettingConfig>> = {
	"github": {
		"githubToken": {
			"key": "github_token",
			"default": "",
			"description": "Personal GitHub Access Token used to authenticate API requests, bypass rate limits, and securely fetch repository source files or assets."
		},
		"ownersList": {
			"key": "owners",
			"default": [
				"briancullinan2",
				"ec-"
			],
			"type": "csv",
			"description": "A list of authorized GitHub organization names or usernames hosting the source code and forks relevant to this project environment."
		},
		"repositoriesList": {
			"key": "repositories",
			"default": [
				"Quake3e",
				"baseq3a"
			],
			"type": "csv",
			"description": "Comma/semicolon-separated list of target GitHub repository names available for compilation selection."
		},
		"defaultRepository": {
			"key": "default_repository",
			"default": "briancullinan2/Quake3e",
			"description": "The fallback or preferred primary repository string formatted as \"owner/repo\" used when loading the workspace workspace initial state."
		},
		"engineRepository": {
			"key": "engine_repository",
			"default": "briancullinan2/Quake3e",
			"description": "The specific Git repository designated for compiling the core Quake 3 WebAssembly engine architecture."
		},
		"gameRepository": {
			"key": "game_repository",
			"default": "briancullinan2/baseq3a",
			"description": "The repository source housing the game logic mod components, including cgame, game, and ui modules."
		},
		"assetRepository": {
			"key": "asset_repository",
			"default": "briancullinan2/multigame-assets",
			"description": "Optional storage repository dedicated to static game assets, maps, texturing bundles, or audio assets required to run the game."
		},
		"toolsRepository": {
			"key": "tools_repository",
			"default": "briancullinan2/q3lcc",
			"description": "Primary compiler tooling repository containing components such as q3lcc (the Quake 3 ANSI C compiler targeting virtual machine bytecode)."
		},
		"tools2Repository": {
			"key": "tools_repository",
			"default": "ec-/q3asm",
			"description": "Secondary toolchain repository hosting utilities like q3asm to assemble the intermediate bytecode files into final .qvm files."
		},
		"rendererRepository": {
			"key": "renderer_repository",
			"default": "briancullinan2/Quake3e",
			"description": "Repository handling the graphical subsystems and pipeline routines tasked with translating engine calculations to browser contexts."
		},
		"environmentRepository": {
			"key": "environment_repository",
			"default": "briancullinan2/gameserver-ts",
			"description": "Repository for this workspace, the entire IDE, code editor and engine runner, for editing the environment inside the workspace."
		},
		"environmentVersion": {
			"key": "environment_version",
			"description": "The last commit date for the environment repository set automatically."
		}
	},
	"core": {
		"workspaceDefault": {
			"key": "workspace_default",
			"default": "fileview",
			"description": "Specifies the default active panel or system layout view presented to users upon launching the application interface."
		},
		"environmentVersion": {
			"key": "environment_version",
			"description": "The last commit date for the environment repository set automatically."
		},
		"savedTheme": {
			"key": "theme",
			"default": "ace/theme/monokai",
			"elementId": "theme",
			"description": "The visual theme layout package used to style the interactive Ace code editor window background and syntax colors."
		},
		"layoutState": {
			"key": "layout",
			"type": "json",
			"default": "{\"panels\":\"left-hand-files\",\"order\":\"normal-order\",\"terminal\":\"terminal\",\"mode\":\"full-mode\"}",
			"description": "The layout order for opening new panels and resizing the window, snaps back to this state when the environment changes."
		},
		"layoutConfiguration": {
			"key": "layout_config",
			"type": "json",
			"description": "Lumino layout configuration according to how tabs are arranged."
		},
		"currentConfig": {
			"key": "configuration",
			"default": "client",
			"elementId": "configuration",
			"description": "Determines the target compilation profile rules, distinguishing targets such as full client builds or dedicated server binaries."
		},
		"hotReload": {
			"key": "hot_reload",
			"default": true,
			"elementId": "reload",
			"type": "boolean",
			"description": "When true, enables immediate compilation triggers and injection changes directly into the live executable WASM state upon saving files."
		}
	},
	"editor": {
		"savedTheme": {
			"key": "theme",
			"default": "ace/theme/monokai",
			"elementId": "theme",
			"description": "The visual theme layout package used to style the interactive Ace code editor window background and syntax colors."
		},
		"savedKeyBinding": {
			"key": "keybinding",
			"default": "ace/keybinding/vim",
			"elementId": "keybinding",
			"description": "Defines the keyboard mapping protocol (e.g., standard, Vim, or Emacs configurations) utilized inside the script editor workspace."
		}
	},
	"filelist": {
		"googleDriveKey": {
			"key": "google_key",
			"default": "AIzaSyAsZR_uPzhdnkNktP8CGKbooWndEUYaq9I",
			"type": "json",
			"description": "google drive API key."
		},
		"googleDriveList": {
			"key": "google_drives",
			"default": [
				"gdrive://1iZXcde4zeQmFJoCedo70wu0ouZ1QF0Se"
			],
			"type": "json",
			"description": "json record of folder ids and folder names."
		},
		"httpIndexList": {
			"key": "http_indexes",
			"default": [
				"${window.location.origin}/clipart"
			],
			"type": "json",
			"description": "json record of index URLs and display names."
		}
	},
	"terminal": {
		"commandHistory": {
			"key": "history",
			"default": [],
			"type": "array",
			"description": "An indexed collection tracking sequential command strings typed into the text interface console for fast history scrolling."
		},
		"terminalLog": {
			"key": "terminal_log",
			"edit": false,
			"default": [],
			"type": "json",
			"description": "Persistent text logging buffer retaining runtime system updates, build logs, and standard out/error print operations."
		}
	}
};
