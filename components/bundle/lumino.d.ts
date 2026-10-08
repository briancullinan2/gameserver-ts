

// ============================================================================
// 2. LUMINO LAYOUT & WINDOW DOM STATE
// ============================================================================

import type { DockPanel, Widget } from "@lumino/widgets";
import type { FileListWidget } from "../filelist/widget";
import type { TerminalWidget } from "../terminal/widget";
import type { StatusBarWidget } from "./status";
import type { LayoutState } from "./menu-app";
import JSZip from "jszip";

import type { GlobalToolbarsWindow, RepositorySettingsWindow } from "./menu.d";
import type { GithubWindow } from "./github.d";
import type { BuildWindow } from "../bundle/make.d";
import type { FileSystemWindow, LuminoLayoutWindow } from "./lumino.d";
import type { SplashScreenWidget } from "./splash";

/**
 * Lumino Dock Panel containers, active widget interaction states, and global event handlers.
 */
export interface LuminoLayoutWindow
{
	Lumino?: {
		widgets: any;
		messaging: any;
		commands: any;
		datagrid: any;
		signaling: any;
	};
	JSZip?: typeof JSZip;

	mainDock?: DockPanel;
	toolbarWidget?: Widget;
	lastInteractedWidget?: Widget | null;
	previousInteractedWidget?: Widget | null;
	fileListWidgets?: Array<FileListWidget>;
	terminalWidgets?: Array<TerminalWidget>;

	statusBar?: StatusBarWidget;
	envStatusNode?: HTMLDivElement;
	currentOpenFileId?: string | null | undefined;
	splashScreen?: SplashScreenWidget;

	layoutState?: LayoutState;
	resizeHandler?: () => void;

	// Keyboard & Modifier State
	isModifierPressed?: boolean;
	isShiftPressed?: boolean;
	updateModifierPressed?: (e: KeyboardEvent) => void;

	fetchAndStore?(baseRoute: string, dependenciesToFetch?: string[]): Promise<[string, boolean]>;
	fetchTranspileAndStore?(baseRoute: string, dependenciesToFetch?: string[]): Promise<string>;
	preloadDependencies?(dependenciesToFetch: string[]): Promise<void>;
	loadScript?: (src: string) => Promise<any>;
	loadStyle?: (href: string) => Promise<void>;
	nextTemp?: () => number;
	FS: {
		virtual: Record<string, FileRecord | null | undefined>;
		pointers?: ([number, string, FileRecord, string, number, number])[];
	};

}

// ============================================================================
// 5. FILE SYSTEM & STORAGE RESOLUTION
// ============================================================================
/**
 * Local IndexedDB container checks and File System Access API directory resolvers.
 */
export interface FileSystemWindow
{
	resolveDirectoryHandle?: (
		rootHandle: FileSystemDirectoryHandle,
		pathSegments: string[]
	) => Promise<FileSystemDirectoryHandle>;

	ensureDatabaseContainer?: (database: string) => Promise<void>;
	globalModules?: Record<string, Record<string, Function>>;
}

export interface LevenshteinWindow
{
	// 1. levDist
	levDist(s: string, t: string): number;

	// 2. levSort (Optional parameters use '?' instead of default values)
	levSort<T>(
		arr: T[],
		search: string,
		getStr?: (item: T) => string
	): T[];

	// 3. levSearch
	levSearch<T extends Record<string, any> = Record<string, any>>(
		cache: T[],
		config: LevSearchConfig,
		search: string
	): any[];

	// 4. getStr helper
	getStr(keys: string | string[], obj: Record<string, any>): string[];

	findMatchesWithFuzzy(currentValue: string, candidatesPool: string[]): string[];
}


export interface LuminoFilesWindow
	extends FileSystemWindow,
	LuminoLayoutWindow,
	RepositorySettingsWindow,
	GlobalToolbarsWindow,
	GithubWindow,
	BuildWindow
{

}
