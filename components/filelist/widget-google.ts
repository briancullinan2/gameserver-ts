import type { FlatFileNode, NestedTreeNode } from "../bundle/github-tools";
import { FileListWidget } from "./widget";
import Tree from './tree.js';
import type { GlobalToolbarsWindow } from "../bundle/menu.d";
import type { GithubWindow } from "../bundle/github.d";
import type { BuildWindow } from "../bundle/make.d";
import type { SettingConfig } from "../bundle/settings.js";
import { Signal, ISignal } from '@lumino/signaling';
import type {
	FilelistWindow, FileWidgetWindow, IErrorEvent,
	IFilesEvent, WidgetErrorEventArgs, WidgetFilesEventArgs
} from "./widget.d";
import { Message } from "@lumino/messaging";

const filelistSelf: GlobalToolbarsWindow & FileWidgetWindow & GithubWindow & BuildWindow
	& FilelistWindow = self as unknown as any;

export interface GoogleDriveFile extends FlatFileNode
{
	mimeType?: string;
	modifiedTime?: string;
	thumbnailLink?: string;
}


export class GoogleDriveWidget extends FileListWidget implements IErrorEvent, IFilesEvent
{
	private rootFolderName: string | null = null;
	private _errorOccurred = new Signal<GoogleDriveWidget, WidgetErrorEventArgs>(this);
	private _filesSignal = new Signal<GoogleDriveWidget, WidgetFilesEventArgs>(this);
	private static _debounceQueries: Record<string, Promise<GoogleDriveFile[] | undefined>> = {};
	private failed: boolean = false;

	get errorOccurred(): ISignal<GoogleDriveWidget, WidgetErrorEventArgs>
	{
		return this._errorOccurred;
	}

	get filesChanged(): ISignal<GoogleDriveWidget, WidgetFilesEventArgs>
	{
		return this._filesSignal;
	}

	constructor(titleStr?: string, source?: string)
	{
		const existing = filelistSelf.fileListWidgets?.find(f => f.constructor.name === GoogleDriveWidget.name);
		if(existing)
		{
			return existing as GoogleDriveWidget;
		}
		super(titleStr, source);
	}

	public processMessage(msg: Message): void
	{
		if(this.failed)
		{
			return super.processMessage(msg);
		}
		if(msg.type === 'close-request')
		{
			this._errorOccurred = new Signal<GoogleDriveWidget, WidgetErrorEventArgs>(this);
		}

		super.processMessage(msg);
	}

	/**
	 * Extracts a raw Google Drive Folder ID from a full share URL or path
	 */
	private extractFolderId(rawSource: string): string
	{
		if(rawSource.includes('/folders/'))
		{
			return rawSource.split('/folders/')[1].split('?')[0];
		}
		return rawSource.replace(/^GoogleDrive\/|gdrive:\/\//i, '').trim();
	}

	public static async fetchDriveFiles(query: string): Promise<GoogleDriveFile[]>
	{
		const apiKey = filelistSelf.settingsManager?.get('filelist', 'google_key');
		// Added thumbnailLink to requested fields
		const fields = 'files(id, name, mimeType, size, thumbnailLink, webContentLink, parents)';

		const params = new URLSearchParams({
			q: query,
			fields: fields,
			key: apiKey,
			pageSize: '1000',
			includeItemsFromAllDrives: 'true',
			supportsAllDrives: 'true'
		});

		const paramsStr = params.toString();

		if(typeof this._debounceQueries[paramsStr] !== 'undefined')
		{
			const results = await this._debounceQueries[paramsStr];
			if(results)
			{
				return results;
			}
		}

		const url = `https://www.googleapis.com/drive/v3/files?${paramsStr}`;

		const debounced = fetch(url, {
			method: 'GET',
			mode: 'cors',
			credentials: 'omit'
		}).then(async response =>
		{
			if(!response.ok)
			{
				const errJson = await response.json().catch(() => ({}));
				throw new Error(errJson.error?.message || `HTTP ${response.status}`);
			}

			const data = await response.json();

			if(!data.files.length)
			{
				throw new Error(`No Drive files! status: ${response.status}`);
			}

			delete this._debounceQueries[paramsStr];
			return data.files || [];
		});

		this._debounceQueries[paramsStr] = debounced;

		return await debounced;
	}

	/**
	 * Shared helper to query Drive API and map results into NestedTreeNode instances
	 */
	public override async fetchFiles(baseNodePath: string): Promise<NestedTreeNode[]>
	{
		if(!this.handleKey)
		{
			return [];
		}

		const q = encodeURIComponent(`'${this.handleKey}' in parents and trashed = false`);

		const driveFiles: GoogleDriveFile[] = await GoogleDriveWidget.fetchDriveFiles(q);


		if(filelistSelf.filesRepo && !filelistSelf.filesRepo[this.handleKey])
		{
			filelistSelf.filesRepo[this.handleKey] = {};
		}

		const nodes: NestedTreeNode[] = [];

		for(const file of driveFiles)
		{
			if(file.name.startsWith('.') || this.isForbidden(file.name)) continue;

			const isDir = file.mimeType === 'application/vnd.google-apps.folder';
			const nodePath = `${baseNodePath}/${file.name}`;
			const nodeId = `${baseNodePath}/${file.id}`;

			const newNode: NestedTreeNode = {
				id: nodeId,
				text: file.name,
				path: nodePath,
				status: 0,
				state: { open: false, expanded: false },
				children: isDir
					? [{ text: 'Loading...', id: `${nodeId}/loading`, path: `${nodePath}/loading`, status: 0, state: { open: false, expanded: false } } as NestedTreeNode]
					: null
			};

			if(filelistSelf.filesRepo?.[this.handleKey] && filelistSelf.FS)
			{
				filelistSelf.filesRepo[this.handleKey]![nodePath] = filelistSelf.FS.virtual[nodePath] = Object.assign(newNode, {
					mode: isDir ? (filelistSelf.FS_DIR ?? 0o040000) : (filelistSelf.FS_FILE ?? (0o100000 | 0o666)),
					driveId: file.id
				});
			}

			this.loadedDatabases[newNode.id] = newNode;
			nodes.push(newNode);
		}

		filelistSelf.sortNodes?.(nodes);
		return nodes;
	}

	/**
	 * Fetches metadata for a public Google Drive folder by ID using search queries
	 */
	private async fetchFolderName(folderId: string): Promise<string>
	{
		const googleDrives = filelistSelf.settingsManager?.get('filelist', 'google_drives') || DEFAULT_DRIVES;
		const apiKey = filelistSelf.settingsManager?.get('filelist', 'google_key');
		if(!apiKey || !folderId || folderId === 'Root') return 'GoogleDrive/Root';

		const cleanFolderId = folderId.includes('/folders/')
			? folderId.split('/folders/')[1].split('?')[0]
			: folderId.replace(/^GoogleDrive\//i, '').trim();

		try
		{
			const q = encodeURIComponent(`'${cleanFolderId}' in parents and trashed = false`);
			const fields = encodeURIComponent('files(id, name, parents)');
			const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&includeItemsFromAllDrives=true&supportsAllDrives=true&key=${apiKey}&pageSize=1000`;

			const response = await fetch(url);

			if(response.ok)
			{
				const data = await response.json();

				if(data.files && data.files.length > 0)
				{
					return `Drive: ${cleanFolderId.substring(0, 8)}...`;
				}
			}

			return googleDrives[cleanFolderId] ?? cleanFolderId;
		}
		catch(err)
		{
			console.error('Failed to resolve Google Drive folder name:', err);
			return googleDrives[cleanFolderId] ?? cleanFolderId;
		}
	}

	/**
	 * Safe HTML Structure Injection
	 */
	protected override async renderLayout(): Promise<void>
	{
		if(this.node.innerHTML !== '')
		{
			return;
		}
		this.node.innerHTML = `
            <div class="filelist-wrapper">
                <ul class="toolbar">
                    <li><a alt="New file" href="#new-file" class="bx bx-file-plus"></a></li>
                    <li><a alt="New folder" href="#new-folder" class="bx bx-folder-plus"></a></li>
                    <li><a alt="Google Drive" href="#new-gdrive" class="bx bxl bx-google-cloud"></a></li>
                    <li><a alt="Hidden Files" href="#hidden" class="bx bx-eye-slash"></a></li>
                    <li><a alt="Github Link" href="#link" class="bx bx-link"></a></li>
                    <li><a alt="Refresh List" href="#refresh" class="bx bx-refresh-cw"></a></li>

                    <li class="setting" data-placeholder="Folder ID">
                        <select name="googledrives" class="filelist-drive">
                        </select>
                    </li>

                </ul>
                <div class="search-box">
                <input type="text" id="search" name="search" placeholder="Search many..." />
                </div>
                <div id="${this.treeContainerId}" class="treejs-render-target"></div>
            </div>
            `;

		const repo = (this.node.querySelector('.filelist-drive') as HTMLSelectElement);
		const repositories = filelistSelf.settingsManager?.get('filelist', 'googleDriveList');
		filelistSelf.updateSelectOptions?.(repo, repositories, this._source ? this.defaultRepository : undefined);
		//console.log('Goddamnit', repositories, Array.from(repo.children).map(c => (c as HTMLOptionElement).value + ' - ' + (c as HTMLOptionElement).innerText));
	}

	protected override async initializeFiletrees(): Promise<void>
	{
		await this.showGitRoot();
		this.bindMutationObserver();
	}

	public override get defaultRepository()
	{
		return this._source ?? (this.node.querySelector('.filelist-drive') as HTMLSelectElement)?.value;
	}

	private isForbidden(name: string): boolean
	{
		const lower = name.toLowerCase();
		return lower.includes('urpm') || lower.includes('naked') || lower.includes('x-rated') || lower.includes('nsfw');
	}

	/**
	 * Lazily load Google Drive subfolders & image files into virtual filesystem
	 */
	protected override async expandDatabaseTree(target: HTMLElement, folderId: string): Promise<void>
	{
		if(this.treeLoading) return;
		if(folderId.endsWith('[Recursive]')) return;

		const activeTree = filelistSelf.trees?.[this.selector];
		if(!activeTree || !activeTree.nodesById[folderId]) return;

		const parts = folderId.split('/');
		let parentDriveId = parts[parts.length - 1];
		if(parentDriveId === 'Root')
		{
			this.handleKey = this.extractFolderId(this.defaultRepository);
		}

		try
		{
			this.treeLoading = true;

			const newChildren = await this.fetchFiles(folderId);

			if(newChildren.length === 0)
			{
				newChildren.push({
					text: 'Empty...',
					id: `${folderId}/empty`,
					path: `${folderId}/empty`,
					status: 0,
					state: { open: false, expanded: false }
				});
			}

			for(const child of newChildren)
			{
				child.parent = activeTree.nodesById[folderId];
				activeTree.nodesById[child.id] = child;
			}

			this.loadedDatabases[folderId].children = activeTree.nodesById[folderId].children = newChildren;

		} catch(err: any)
		{
			console.error(`Failed to load Drive tree node: ${err.message}`);
			this._errorOccurred.emit({
				source: this,
				error: err instanceof Error ? err : String(err),
			});
			this.loadedDatabases[folderId] = {
				children: [{
					text: 'Error loading drive files',
					id: 'err',
					path: 'err',
					status: 0,
					state: { open: false, expanded: false }
				} as NestedTreeNode]
			} as NestedTreeNode;
		}

		await this.showGitRoot(folderId);

		if(this.refreshTreeTimer) clearTimeout(this.refreshTreeTimer);

		this.refreshTreeTimer = setTimeout(async () =>
		{
			activeTree.values = [];
			const node = activeTree.nodesById[folderId];
			if(node) activeTree.open(node);
			setTimeout(() => { this.treeLoading = false; }, 300);
		}, 200);
	}

	private async showGitRoot(folderId?: string): Promise<void>
	{
		const rawFolderId = this.extractFolderId(this.defaultRepository);
		const database = this.defaultRepository;

		// Fetch folder name if not resolved yet
		/*
		if(!this.rootFolderName)
		{
			this.rootFolderName = await this.fetchFolderName(rawFolderId);

			// Update option text in .filelist-drive select element
			const repoSelect = this.node.querySelector('.filelist-drive') as HTMLSelectElement;
			if(repoSelect)
			{
				const option = Array.from(repoSelect.options).find(opt => opt.value === database || opt.value === rawFolderId);
				if(option)
				{
					option.textContent = this.rootFolderName;
				}
				else
				{
					const newOpt = document.createElement('option');
					newOpt.value = database;
					newOpt.textContent = this.rootFolderName;
					newOpt.selected = true;
					repoSelect.appendChild(newOpt);
				}
			}
		}
		*/

		const rootDisplayText = this.rootFolderName || database;
		let rootChildren: NestedTreeNode[] = [];
		if(!this.loadedDatabases[database])
		{
			try
			{
				this.handleKey = rawFolderId;
				rootChildren = await this.fetchFiles('');
				if(rootChildren.length === 0)
				{
					// TODO?
				} else
				{
					this._filesSignal.emit({
						source: this,
						items: rootChildren
					});
				}
			}
			catch(err)
			{
				console.error('Failed to initialize top-level Google Drive children:', err);
				this._errorOccurred.emit({
					source: this,
					error: err instanceof Error ? err : String(err),
				});
				this.failed = true;
				return;
			}
		}
		else
		{
			this.loadedDatabases[database].text = rootDisplayText;
		}

		this.showFileTree(folderId, this.loadedDatabases[database].children ?? rootChildren);
	}
}

filelistSelf.GoogleDriveWidget = GoogleDriveWidget;


const DEFAULT_DRIVES: Record<string, string> = {};
const LOCAL_SETTINGS: Record<string, Record<string, SettingConfig>> = {
	filelist: {
		googleDriveKey: {
			key: 'google_key',
			default: 'AIzaSyAsZR_uPzhdnkNktP8CGKbooWndEUYaq9I',
			type: 'json',
			description: 'google drive API key.',
		},
		googleDriveList: {
			key: 'google_drives',
			default: ['gdrive://1iZXcde4zeQmFJoCedo70wu0ouZ1QF0Se'],
			type: 'json',
			description: 'json record of folder ids and folder names.',
			set: (val: string[]): void =>
			{
				// TODO: swap to drive toolbar instead of github
				// TODO: swap to file name toolbar when on a local FS
				//updateSelectOptions(RepositoryToolbar.repository, val);
			}
		},
	}
};

if(!filelistSelf.IMPORT_SETTINGS)
{
	filelistSelf.IMPORT_SETTINGS = {};
}

for(const [moduleKey, configs] of Object.entries(LOCAL_SETTINGS))
{
	filelistSelf.IMPORT_SETTINGS[moduleKey] = {
		...(filelistSelf.IMPORT_SETTINGS[moduleKey] || {}),
		...configs
	};
}

// 4. Export the unified reference for standard module compilation tracking
export const IMPORT_SETTINGS = filelistSelf.IMPORT_SETTINGS;
