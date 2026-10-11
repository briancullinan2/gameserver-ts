import { Widget } from '@lumino/widgets';


export interface FolderConfigItem
{
	id: string; // IDB name
	alias: string;
	description: string; // e.g. Win/Mac/Linux abbreviation + alias
	systemPath: string;  // Estimated real path for backend watcher
	type: string;
	fileCount: number;
	isRemovable: boolean;
	isMounted: boolean;
}

export interface SpecialPathPreset
{
	label: string;
	category: string;
	winPath: string;
	macPath: string;
	linuxPath: string;
}

export class FolderWizardWidget extends Widget
{
	private folders: Map<string, FolderConfigItem> = new Map();
	private isMiddlewareEnabled: boolean = false;
	private isConnectedToMiddleware: boolean = false;

	private listContainer!: HTMLDivElement;
	private statusDotElement!: HTMLDivElement;
	private fileInputRef!: HTMLInputElement;
	private folderInputRef!: HTMLInputElement;

	// Comprehensive OS Special Paths & Common System Presets
	public static readonly SPECIAL_PATHS: SpecialPathPreset[] = [
		{ label: 'Home Directory', category: 'Special', winPath: '%USERPROFILE%', macPath: '~', linuxPath: '~' },
		{ label: 'App Configuration', category: 'Special', winPath: '%APPDATA%', macPath: '~/Library/Application Support', linuxPath: '~/.config' },
		{ label: 'System Temp', category: 'Special', winPath: '%TEMP%', macPath: '/private/tmp', linuxPath: '/tmp' },
		{ label: 'Documents', category: 'Special', winPath: '%USERPROFILE%\\Documents', macPath: '~/Documents', linuxPath: '~/Documents' },
		{ label: 'Downloads', category: 'Common', winPath: '%USERPROFILE%\\Downloads', macPath: '~/Downloads', linuxPath: '~/Downloads' },
		{ label: 'Desktop', category: 'Common', winPath: '%USERPROFILE%\\Desktop', macPath: '~/Desktop', linuxPath: '~/Desktop' },
		{ label: 'Steam Library / Games', category: 'Gaming', winPath: 'C:\\Program Files (x86)\\Steam\\steamapps', macPath: '~/Library/Application Support/Steam/steamapps', linuxPath: '~/.local/share/Steam/steamapps' },
		{ label: 'LaunchBox / ROMs', category: 'Gaming', winPath: 'C:\\LaunchBox\\Games', macPath: '/Applications/LaunchBox/Games', linuxPath: '/opt/launchbox/games' },

		// 📁 User Data & Documents
		{ label: 'Home Directory', category: 'Special', winPath: '%USERPROFILE%', macPath: '~', linuxPath: '~' },
		{ label: 'Documents', category: 'User Data', winPath: '%USERPROFILE%\\Documents', macPath: '~/Documents', linuxPath: '~/Documents' },
		{ label: 'Music', category: 'User Data', winPath: '%USERPROFILE%\\Music', macPath: '~/Music', linuxPath: '~/Music' },
		{ label: 'Pictures', category: 'User Data', winPath: '%USERPROFILE%\\Pictures', macPath: '~/Pictures', linuxPath: '~/Pictures' },
		{ label: 'Videos', category: 'User Data', winPath: '%USERPROFILE%\\Videos', macPath: '~/Movies', linuxPath: '~/Videos' },
		{ label: 'Desktop', category: 'User Data', winPath: '%USERPROFILE%\\Desktop', macPath: '~/Desktop', linuxPath: '~/Desktop' },
		{ label: 'Templates', category: 'User Data', winPath: '%USERPROFILE%\\Templates', macPath: '~/Templates', linuxPath: '~/Templates' },
		{ label: 'Favorites', category: 'User Data', winPath: '%USERPROFILE%\\Favorites', macPath: '~/Library/Favorites', linuxPath: '~/.local/share/favorites' },

		// ⚙️ Application Settings & Configuration
		{ label: 'App Configuration (Roaming)', category: 'Settings', winPath: '%APPDATA%', macPath: '~/Library/Application Support', linuxPath: '~/.config' },
		{ label: 'Local Application Data', category: 'Settings', winPath: '%LOCALAPPDATA%', macPath: '~/Library/Application Support', linuxPath: '~/.local/share' },
		{ label: 'Common Application Data', category: 'Settings', winPath: '%PROGRAMDATA%', macPath: '/Library/Application Support', linuxPath: '/var/lib' },

		// 🖥️ System & Operating System Files
		{ label: 'System Directory', category: 'System', winPath: '%WINDIR%\\System32', macPath: '/System/Library', linuxPath: '/lib' },
		{ label: 'System X86 Directory', category: 'System', winPath: '%WINDIR%\\SysWOW64', macPath: '/System/Library', linuxPath: '/lib32' },
		{ label: 'Windows Root', category: 'System', winPath: '%WINDIR%', macPath: '/System', linuxPath: '/' },
		{ label: 'System Fonts', category: 'System', winPath: '%WINDIR%\\Fonts', macPath: '~/Library/Fonts', linuxPath: '~/.local/share/fonts' },

		// 🚀 Program Files & Executables
		{ label: 'Program Files', category: 'Binaries', winPath: 'C:\\Program Files', macPath: '/Applications', linuxPath: '/usr/share' },
		{ label: 'Program Files (X86)', category: 'Binaries', winPath: 'C:\\Program Files (x86)', macPath: '/Applications', linuxPath: '/usr/lib' },
		{ label: 'Common Program Files', category: 'Binaries', winPath: 'C:\\Program Files\\Common Files', macPath: '/Library/Application Support', linuxPath: '/usr/share' },

		// 🌐 Shortcuts, Menus, & Shell Legacy
		{ label: 'Start Menu Programs', category: 'Shell', winPath: '%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs', macPath: '~/Applications', linuxPath: '~/.local/share/applications' },
		{ label: 'Startup Items', category: 'Shell', winPath: '%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup', macPath: '~/Library/LaunchAgents', linuxPath: '~/.config/autostart' },
		{ label: 'Send To Menu', category: 'Shell', winPath: '%APPDATA%\\Microsoft\\Windows\\SendTo', macPath: '~/Library/Services', linuxPath: '~/.local/share/kio/servicemenus' },
		{ label: 'Recent Documents', category: 'Shell', winPath: '%APPDATA%\\Microsoft\\Windows\\Recent', macPath: '~/Library/Recent', linuxPath: '~/.local/share/recently-used.xbel' },
		{ label: 'Internet Cache & History', category: 'Shell', winPath: '%LOCALAPPDATA%\\Microsoft\\Windows\\INetCache', macPath: '~/Library/Caches', linuxPath: '~/.cache' }

	];

	constructor()
	{
		super();
		this.addClass('lm-FolderWizard');
		this.createDomStructure();
		this.bindEvents();
		this.renderFolders();
		this.title.label = 'Shared Folders';
		this.title.iconClass = 'fas fa-folder-tree';
	}

	private createDomStructure(): void
	{
		this.node.innerHTML = `
      <div class="lm-FolderWizard-toolbar">
        <button class="lm-FolderWizard-btn primary btn-refresh">
			<i class="bi bi-refresh-cw"></i>
		</button>
        <button class="lm-FolderWizard-btn primary btn-add-file">
          <i class="bi bi-file-earmark-plus"></i> Add Single File
        </button>
        <button class="lm-FolderWizard-btn primary btn-add-folder">
          <i class="bi bi-folder-plus"></i> Add Folder
        </button>
        <button class="lm-FolderWizard-btn btn-upload-file">
          <i class="bi bi-upload"></i> Upload File
        </button>
        <button class="lm-FolderWizard-btn btn-upload-folder">
          <i class="bx bx-folder-open"></i> Upload Folder
        </button>
		<div class="lm-FolderWizard-middlewareControl">
          <div class="lm-FolderWizard-statusDot" title="Middleware Watcher Status"></div>
          <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
            <input type="checkbox" class="middleware-toggle" />
            Enable Middleware Watcher
          </label>
        </div>
      </div>

      <div class="lm-FolderWizard-listContainer"></div>

      <!-- Hidden file/folder inputs for traditional uploads -->
      <input type="file" class="hidden-file-input" style="display: none;" />
      <input type="file" class="hidden-folder-input" style="display: none;" webkitdirectory directory multiple />
    `;

		this.listContainer = this.node.querySelector('.lm-FolderWizard-listContainer') as HTMLDivElement;
		this.statusDotElement = this.node.querySelector('.lm-FolderWizard-statusDot') as HTMLDivElement;
		this.fileInputRef = this.node.querySelector('.hidden-file-input') as HTMLInputElement;
		this.folderInputRef = this.node.querySelector('.hidden-folder-input') as HTMLInputElement;
	}

	private bindEvents(): void
	{
		const checkbox = this.node.querySelector('.middleware-toggle') as HTMLInputElement;
		checkbox.addEventListener('change', (e) =>
		{
			this.isMiddlewareEnabled = (e.target as HTMLInputElement).checked;
			this.isConnectedToMiddleware = this.isMiddlewareEnabled; // Simulate successful handshake
			this.updateMiddlewareStatusUI();
		});

		this.node.querySelector('.btn-add-folder')?.addEventListener('click', () => this.handleBrowserDirectoryPicker());
		this.node.querySelector('.btn-add-file')?.addEventListener('click', () => this.handleBrowserFilePicker());
		this.node.querySelector('.btn-upload-file')?.addEventListener('click', () => this.fileInputRef.click());
		this.node.querySelector('.btn-upload-folder')?.addEventListener('click', () => this.folderInputRef.click());
	}

	private updateMiddlewareStatusUI(): void
	{
		if(!this.isMiddlewareEnabled)
		{
			this.statusDotElement.className = 'lm-FolderWizard-statusDot';
			this.statusDotElement.title = 'Middleware disabled';
		} else if(this.isConnectedToMiddleware)
		{
			this.statusDotElement.className = 'lm-FolderWizard-statusDot is-connected';
			this.statusDotElement.title = 'Middleware watcher connected & operating correctly';
		} else
		{
			this.statusDotElement.className = 'lm-FolderWizard-statusDot is-error';
			this.statusDotElement.title = 'Middleware connection failed';
		}
	}

	/**
	 * Use Native File System Access API for Directory Picking
	 */
	private async handleBrowserDirectoryPicker(): Promise<void>
	{
		try
		{
			if(!('showDirectoryPicker' in window))
			{
				alert('File System Access API (showDirectoryPicker) is not supported in this browser.');
				return;
			}

			const dirHandle = await (window as any).showDirectoryPicker();
			const alias = dirHandle.name;
			const preset = FolderWizardWidget.SPECIAL_PATHS[0]; // Default fallback estimate

			this.addFolderConfig({
				id: `idb_${alias.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
				alias: alias,
				description: `[Win: ${preset.winPath}\\${alias}] (${alias})`,
				systemPath: `${preset.winPath}\\${alias}`,
				type: 'directory',
				fileCount: Math.floor(Math.random() * 150) + 12,
				isRemovable: false,
				isMounted: true
			});
		} catch(err: any)
		{
			if(err.name !== 'AbortError')
			{
				console.error('Directory picker error:', err);
			}
		}
	}

	private async handleBrowserFilePicker(): Promise<void>
	{
		try
		{
			if(!('showOpenFilePicker' in window))
			{
				this.fileInputRef.click();
				return;
			}
			const [fileHandle] = await (window as any).showOpenFilePicker();
			const file = await fileHandle.getFile();

			this.addFolderConfig({
				id: `idb_file_${file.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
				alias: file.name,
				description: `[Single File] (${file.name})`,
				systemPath: `~/Documents/${file.name}`,
				type: 'file',
				fileCount: 1,
				isRemovable: false,
				isMounted: true
			});
		} catch(err: any)
		{
			if(err.name !== 'AbortError')
			{
				console.error('File picker error:', err);
			}
		}
	}

	public addFolderConfig(config: FolderConfigItem): void
	{
		this.folders.set(config.id, config);
		this.renderFolders();
	}

	public renderFolders(): void
	{
		this.listContainer.innerHTML = '';

		if(this.folders.size === 0)
		{
			this.listContainer.innerHTML = `
        <div class="empty-folder-list">
          <i class="fas fa-folder-open" style="font-size: 24px; margin-bottom: 8px; display: block;"></i>
          No folder configurations found. Add a folder or file to begin indexing.
        </div>
      `;
			return;
		}

		for(const folder of this.folders.values())
		{
			const card = document.createElement('div');
			card.className = `lm-FolderWizard-card ${!folder.isMounted ? 'is-removable-missing' : ''}`;

			card.innerHTML = `
        <div class="lm-FolderWizard-cardHeader">
          <div class="lm-FolderWizard-cardInfo">
            <div class="lm-FolderWizard-alias">
              <i class="${folder.type === 'directory' ? 'fas fa-folder' : 'bi bi-file-earmark'}"></i>
              ${folder.alias}
              ${!folder.isMounted ? '<span style="font-size:10px; color:#ef4444; font-weight:normal;">(Removable Storage Offline)</span>' : ''}
            </div>
            <div class="lm-FolderWizard-desc">${folder.description}</div>
          </div>
          <div class="lm-FolderWizard-actions">
            <button class="lm-FolderWizard-iconBtn btn-toggle-expand" title="Toggle Settings & Details">
              <i class="bx bx-chevron-down" style="font-size: 18px;"></i>
            </button>
            <button class="lm-FolderWizard-iconBtn btn-edit" title="Edit Configuration">
              <i class="bx bx-edit-alt"></i>
            </button>
          </div>
        </div>

        <div class="lm-FolderWizard-detailsPanel">
          <div class="lm-FolderWizard-detailGrid">
            <div class="lm-FolderWizard-detailItem">
              <span class="lm-FolderWizard-detailLabel">Indexed DB Name</span>
              <span class="lm-FolderWizard-detailValue">${folder.id}</span>
            </div>
            <div class="lm-FolderWizard-detailItem">
              <span class="lm-FolderWizard-detailLabel">Indexed Files Count</span>
              <span class="lm-FolderWizard-detailValue">${folder.fileCount} items</span>
            </div>
            <div class="lm-FolderWizard-detailItem" style="grid-column: span 2;">
              <span class="lm-FolderWizard-detailLabel">Backend Watcher Path</span>
              <span class="lm-FolderWizard-detailValue">${folder.systemPath}</span>
            </div>
          </div>
          <div class="lm-FolderWizard-linkRow">
            <a href="#view-files-${folder.id}" class="lm-FolderWizard-link" onclick="return false;">
              <i class="fas fa-eye"></i> View Files
            </a>
            <a href="#view-db-${folder.id}" class="lm-FolderWizard-link" onclick="return false;">
              <i class="bx bx-data"></i> View Database View
            </a>
          </div>
        </div>
      `;

			// Accordion toggle action
			const expandBtn = card.querySelector('.btn-toggle-expand') as HTMLButtonElement;
			expandBtn.addEventListener('click', () =>
			{
				card.classList.toggle('is-expanded');
				const icon = expandBtn.querySelector('i')!;
				icon.className = card.classList.contains('is-expanded') ? 'bx bx-chevron-up' : 'bx bx-chevron-down';
			});

			this.listContainer.appendChild(card);
		}
	}
}
