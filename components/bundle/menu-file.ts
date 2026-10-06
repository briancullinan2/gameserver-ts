import { CommandRegistry } from "@lumino/commands";
import { Widget } from "@lumino/widgets";
import { MenuConfig, MenuManager } from "./menu-manager";
import { triggerPanelRoute } from "./menu";
import type { GlobalToolbarsWindow, LuminoMenuWindow } from "./menu.d";
import type { FileSystemWindow, LuminoLayoutWindow } from "./lumino.d";
import type { EditorWindow } from "../editor/widget.d";

const menuSelf: LuminoMenuWindow & GlobalToolbarsWindow & FileSystemWindow
	& LuminoLayoutWindow & EditorWindow = self as unknown as any;

const FILE_MENU: MenuConfig = {
	name: "File",
	iconClass: "bx bx-file",
	children: [{
		name: "New",
		target: "file/new.new",
		iconClass: "bx bx-file"
	}, {
		divider: true
	}, {
		name: "Open",
		iconClass: "bx bx-folder-open",
		children: [{
			name: "Open File",
			shortcut: "Ctrl+O",
			ellipsis: true,
			target: "file/open.open_file",
			iconClass: "bx bx-file"
		}, {
			name: "Open Directory",
			ellipsis: true,
			target: "file/open.open_dir",
			iconClass: "bx bx-folder"
		}, {
			name: "Open from Webcam",
			target: "file/open.open_webcam",
			iconClass: "bx bx-webcam"
		}, {
			name: "Open URL",
			ellipsis: true,
			target: "file/open.open_url",
			iconClass: "bx bx-link"
		}, {
			name: "Open Data URL",
			ellipsis: true,
			target: "file/open.open_data_url",
			iconClass: "bx bx-code-alt"
		}, {
			name: "Open Test Template",
			target: "file/open.open_template_test",
			iconClass: "bx bx-extension"
		}]
	}, {
		name: "Load Sample File",
		target: "file/load_sample",
		iconClass: "bx bx-file"
	},
	{
		name: "New Recording",
		target: "file/new_recording",
		iconClass: "bx bx-video-plus"
	},
	{
		name: "Save Draft Locally",
		ellipsis: true,
		target: "file/save_draft_local",
		iconClass: "bx bx-save"
	},
	{
		name: "Open Local Drafts",
		ellipsis: true,
		target: "file/open_drafts_local",
		iconClass: "bx bx-folder-open"
	}, {
		divider: true
	}, {
		name: "Auto Save",
		target: "ace_file.toggle_auto_save",
		iconClass: "bx bx-history"
	}, {
		divider: true
	}, {
		name: "Save",
		ellipsis: true,
		shortcut: "Ctrl+S",
		target: "file/save.export",
		iconClass: "bx bx-save"
	}, {
		name: "Save As",
		ellipsis: true,
		shortcut: "Shift + S",
		target: "file/save.save",
		iconClass: "bx bx-file-plus"
	}, {
		name: "Save As Data URL",
		ellipsis: true,
		target: "file/save.save_data_url",
		iconClass: "bx bx-code-alt"
	}, {
		name: "Print",
		ellipsis: true,
		shortcut: "Ctrl+P",
		target: "file/print.print",
		iconClass: "bx bx-printer"
	}, {
		divider: true
	},
	{
		name: "Settings",
		target: "file/settings",
		iconClass: "bx bx-cog"
	},
	{
		divider: true
	},
	{
		name: "Publish",
		iconClass: "bx bx-archive-arrow-up",
		children: [
			{ name: "Web", target: "file/publish/web", iconClass: "bx bx-globe" },
			{ name: "Windows", target: "file/publish/windows", iconClass: "bxl bx-microsoft" },
			{ name: "Linux", target: "file/publish/linux", iconClass: "bxl bx-tux" },
			{ name: "macOS", target: "file/publish/macos", iconClass: "bxl bx-apple" }
		]
	},
	{
		name: "Import",
		iconClass: "bx bx-archive-arrow-down",
		target: "file/import"
	},
	{
		divider: true
	},
	{
		name: "Quick Save",
		shortcut: "F9",
		target: "file/quicksave.quicksave",
		iconClass: "bx bx-bolt-circle"
	}, {
		name: "Quick Load",
		shortcut: "F10",
		target: "file/quickload.quickload",
		iconClass: "bx bx-refresh-ccw"
	}, {
		divider: true
	},
	{
		name: "Exit IDE",
		shortcut: "F10",
		target: "file/exit.exit",
		iconClass: "bx bx-power"
	}]
};


const HELP_MENU: MenuConfig = {
	name: "Help",
	iconClass: "bx bx-help-circle",
	children: [{
		name: "Keyboard Shortcuts",
		ellipsis: true,
		target: "help/shortcuts.shortcuts",
		iconClass: "bx bx-keyboard"
	}, {
		name: "Report Issues",
		href: "https://github.com/briancullinan2/gameserver-ts/issues",
		iconClass: "bx bx-bug"
	}, {
		divider: true
	}, {
		name: "About",
		ellipsis: true,
		target: "help/about.about",
		iconClass: "bx bx-info-circle"
	}, {
		divider: true
	}, {
		name: "Store Offline Version",
		target: "help/store_offline",
		iconClass: "bx bx-wifi-slash"
	}, {
		name: "See Welcome Message",
		target: "help/see_welcome",
		iconClass: "bx bx-smile"
	}, {
		name: "SourceCode on Github",
		href: "https://github.com/briancullinan2/nediaserver-ts",
		iconClass: "bxl bx-github"
	}]
};


export class FileToolbar extends Widget
{
	private static _instance: FileToolbar | null = null;
	private _commands: CommandRegistry | null = null;

	private constructor()
	{
		super();
		this.id = 'file-inline-toolbar';
		this._buildInterface();
	}

	public static getInstance(): FileToolbar
	{
		if(!FileToolbar._instance)
		{
			FileToolbar._instance = new FileToolbar();
			menuSelf.fileToolbar = FileToolbar._instance;
		}
		return FileToolbar._instance;
	}

	public initialize(commands: CommandRegistry): FileToolbar
	{
		this._commands = commands;
		menuSelf.registerAllCommands?.(FILE_MENU);
		menuSelf.registerAllCommands?.(HELP_MENU);
		MenuManager.injectMenus(null, FILE_MENU);
		MenuManager.injectMenus(null, HELP_MENU);
		return this;
	}


	private _buildInterface(): void
	{
		this.node.innerHTML = `
            <button id="file-bar-btn-new" title="New File" class="bx bx-file-plus"></button>
            <button id="file-bar-btn-save" title="Save File" class="bx bx-save"></button>
            <button id="file-bar-btn-upload" title="Upload File" class="bx bx-folder-up-arrow"></button>
            <button id="file-bar-btn-undo" title="Back" class="bx bx-undo"></button>
            <button id="file-bar-btn-redo" title="Next" class="bx bx-redo"></button>
        `;

		this.node.querySelector('#file-bar-btn-new')?.addEventListener('click', () =>
		{
			this._commands?.execute('file/new.new');
		});

		this.node.querySelector('#file-bar-btn-save')?.addEventListener('click', () =>
		{
			this._commands?.execute('file/save.save');
		});

		this.node.querySelector('#file-bar-btn-upload')?.addEventListener('click', () =>
		{
			this._commands?.execute('file/open.open_dir');
		});

		this.node.querySelector('#file-bar-btn-undo')?.addEventListener('click', () =>
		{
			this._commands?.execute('edit/undo.undo');
		});

		this.node.querySelector('#file-bar-btn-redo')?.addEventListener('click', () =>
		{
			this._commands?.execute('edit/redo.redo');
		});
	}

	public static closeApp()
	{
		if(confirm('Are you sure you want to exit?'))
		{
			window.close();
		}
	}
}

menuSelf.FileToolbar = FileToolbar;

const fileGroups = {
	// Standard Web/Texture assets
	'Images (*.png, *.jpg, *.tga, *.pcx)': [
		'image/png',
		'image/jpeg',
		'image/x-tga',
		'.tga',
		'.pcx'
	],

	// Map geometry types
	'Quake 3 Maps (*.bsp, *.aas)': [
		'application/x-quake3-map',
		'.bsp',
		'.aas'
	],

	// Scripts, Shaders, and Configuration plain text targets
	'Text & Scripts (*.shader, *.cfg, *.qvm)': [
		'text/plain',
		'.shader',
		'.cfg',
		'.qvm'
	],

	// 3D Model asset packages
	'3D Models (*.md3, *.md4)': [
		'application/x-quake3-model',
		'.md3',
		'.md4'
	],

	// Compressed pak collections
	'Game Archives (*.pk3)': [
		'application/zip',
		'.pk3'
	]
};

const targetAcceptString = Object.values(fileGroups)
	.reduce((acc, currentGroup) => acc.concat(currentGroup), [])
	.join(',');

if(!menuSelf.globalModules)
{
	menuSelf.globalModules = {};
}

menuSelf.globalModules['file/exit'] = {
	exit: FileToolbar.closeApp
};
menuSelf.globalModules['file/open'] = {
	open_file: function ()
	{
		var _this = this;

		// TODO: special actions for open widget
		//if(menuSelf.lastInteractedWidget?.constructor.name === 'PaintWidget'
		//	&& (menuSelf.lastInteractedWidget as PaintWidget)._instance
		//	&& (menuSelf.lastInteractedWidget as PaintWidget)._instance?.alertify
		//)
		//{
		//	const alertify = (menuSelf.lastInteractedWidget as PaintWidget)._instance!.alertify;
		//	alertify.success('You can also drag and drop items into browser.');
		//}

		const temp = document.getElementById("tmp");
		if(temp)
		{
			temp.innerHTML = '';
			var a = document.createElement('input');
			a.setAttribute("id", "file_open");
			a.setAttribute('accept', targetAcceptString);
			a.type = 'file';
			a.multiple = true;
			temp.appendChild(a);
			a.addEventListener('change', function (event: any)
			{
				const files = event.target?.files || event.dataTransfer?.files;

				if(files && files.length > 0)
				{
				}
				/* TODO:
				_this.open_handler(e);
				const isQuakeAsset = filename.endsWith('.bsp') ||
					filename.endsWith('.aas') ||
					filename.endsWith('.qvm') ||
					filename.endsWith('.md3') ||
					filename.endsWith('.dat');

				if (isQuakeAsset) {
					console.log(`Intercepted Quake 3 asset by extension: ${file.name}. Routing to custom engine...`);
					routeFileToQuakeEditor(file);
					return; // Stop execution here. miniPaint never touches it!
				}
				*/

			}, false);
			//force click
			a.click();
		}
	}
};

menuSelf.globalModules['file/new'] = {
	new: function ()
	{
		const candidateTypes = ['AceEditorWidget', 'PaintWidget'];
		// TODO: scan widgets for open editors and create a new file inside that editor
		//   if there is none, make a new ace editor file
		const editorCandidates: string[] = [];
		if(menuSelf.lastInteractedWidget
			&& candidateTypes.includes(menuSelf.lastInteractedWidget.constructor.name))
		{
			editorCandidates.push(menuSelf.lastInteractedWidget.constructor.name);
		}
		if(menuSelf.previousInteractedWidget
			&& candidateTypes.includes(menuSelf.previousInteractedWidget.constructor.name))
		{
			editorCandidates.push(menuSelf.previousInteractedWidget.constructor.name);
		}
		for(let panel in menuSelf.mainDock?.widgets() ?? [])
		{
			if(candidateTypes.includes(panel.constructor.name))
			{
				editorCandidates.push(panel.constructor.name);
			}
		}
		if(editorCandidates[0] === 'AceEditorWidget')
		{
			menuSelf.AceEditorWidget?.openFileInNewTab('new-file-' + menuSelf.nextTemp?.(), 'New File', '');
		}
	}

};
