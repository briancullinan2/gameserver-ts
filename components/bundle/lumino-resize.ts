import { BoxPanel, DockPanel, FocusTracker, MenuBar, Panel, Widget } from "@lumino/widgets";
import { LayoutAdjuster, MOBILEMODE, WIDESCREEN, TALLSCREEN, WidgetType } from "./lumino-widget";
import type { LuminoLayoutWindow } from "./lumino.d";
import type { GlobalToolbarsWindow } from "./menu.d";


const luminoSelf: LuminoLayoutWindow & GlobalToolbarsWindow = self as unknown as any;


export interface LuminoLayoutNode
{
	type: 'tab-area' | 'split-area';
	orientation?: 'horizontal' | 'vertical';
	children?: LuminoLayoutNode[];
	widgets?: any[];
	sizes?: number[];
}

export interface SafeLayoutNode
{
	type: 'split-area' | 'tab-area';
	orientation?: 'horizontal' | 'vertical';
	sizes?: number[];
	currentIndex?: number;
	children?: SafeLayoutNode[];
	widgets?: string[]; // Store widget IDs instead of live Widget objects
}

export interface SafeDockLayoutConfig
{
	main: SafeLayoutNode | null;
}


export type ToolbarKey = 'repositoryToolbar' | 'scriptToolbar'
	| 'appToolbar' | 'fileToolbar' | 'historyToolbar' | 'settingsToolbar'
	| 'editToolbar' | 'viewToolbar' | 'layoutToolbar';


export const OUTLINE_WIDGET_TYPES = [
	'FileListWidget', 'GameListWidget',
	'DatabaseListWidget', 'AssetListWidget',
	'GithubListWidget', 'SearchListWidget',
	'SkillsWidget', 'GoogleDriveWidget',
	'HttpIndexWidget', 'PlaylistWidget',
	'XRayPanelWidget', 'ThreadListWidget',
	'ToolsSidebar', 'TemplateCategoryWidget',
	'MasterListWidget'
];


/**
 * Inverted Registry: Maps each Toolbar to the Widget classes that activate it.
 */
export const TOOLBAR_CONTEXT_MAP: Record<ToolbarKey, string[]> = {
	appToolbar: [
		'TerminalWidget', 'AceEditorWidget', 'PaintWidget', 'NunuStudioWidget',
		'TojiWidget', 'FileListWidget', 'GameListWidget', 'GoogleDriveWidget',
		'AssetListWidget', 'HttpIndexWidget', 'GithubWidget', 'SettingsWidget', 'SearchWidget', 'AudioEditorWidget',
		'FileviewWidget'
	],
	fileToolbar: [
		'AceEditorWidget', 'FileListWidget', 'GameListWidget', 'AssetListWidget', 'HttpIndexWidget', 'GoogleDriveWidget', 'FileviewWidget'
	],
	editToolbar: [
		'AceEditorWidget', 'FileListWidget', 'GameListWidget', 'AssetListWidget', 'HttpIndexWidget', 'GoogleDriveWidget', 'FileviewWidget'
	],
	viewToolbar: [
		'FileviewWidget'
	],
	layoutToolbar: [
		'TerminalWidget', 'AceEditorWidget', 'PaintWidget', 'NunuStudioWidget',
		'TojiWidget', 'FileListWidget', 'GameListWidget', 'GoogleDriveWidget',
		'AssetListWidget', 'HttpIndexWidget', 'GithubWidget', 'SettingsWidget', 'SearchWidget', 'AudioEditorWidget',
		'FileviewWidget'
	],
	scriptToolbar: [
		'TerminalWidget', 'AceEditorWidget'
	],
	repositoryToolbar: [
		'FileListWidget', 'GameListWidget', 'AssetListWidget', 'GithubWidget'
	],
	historyToolbar: [
		'PaintWidget', 'NunuStudioWidget', 'AceEditorWidget', 'AudioEditorWidget'
	],
	settingsToolbar: [
		'NunuStudioWidget', 'SettingsWidget', 'TerminalWidget'
	]
};

// Array for iterating through your global window instances safely
const ALL_TOOLBARS = Object.keys(TOOLBAR_CONTEXT_MAP) as ToolbarKey[];


export class ResponsiveManager
{
	private static _instance: ResponsiveManager | null = null;
	private _prevWidgetCount: number = 0;

	private _savedLayoutState: DockPanel.ILayoutConfig | null = null;
	private _isMobileCollapsed?: boolean = undefined;
	private _isWidescreenSplit?: boolean = undefined;
	alreadyResizing: boolean = false;
	resizeTimeout: ReturnType<typeof setTimeout> | null = null;

	private constructor() { }

	public static getInstance(): ResponsiveManager
	{
		if(!ResponsiveManager._instance)
		{
			ResponsiveManager._instance = new ResponsiveManager();
		}
		return ResponsiveManager._instance;
	}

	/**
	 * Single Entry Chain Controller
	 */
	public async handleResize(
		windowRoot: BoxPanel,
		workspaceBox: BoxPanel,
		headerRow: Panel,
		menuBar: MenuBar,
		toolbar: Widget,
		mainDock: DockPanel
	): Promise<void>
	{
		if(this.resizeTimeout)
		{
			clearTimeout(this.resizeTimeout);
		}
		this.resizeTimeout = setTimeout(async () =>
		{

			isDevToolsOpen();

			const currentWidgets = Array.from(mainDock.widgets());

			// 0. Pre-check screen dimensions & collapse tabs/panels if on mobile screens
			this._handleResponsiveCollapse(mainDock);

			// 1. Process responsive visibility rules & directions
			this._updateVisibility(workspaceBox, toolbar);

			// 2. Measure wrapped DOM layout sizes & update Lumino layout limits
			this._recalculateToolbarHeight(headerRow);
			await this._recalculateDockTabHeights(mainDock);

			// 3. Process layout constraints if widget viewport configurations change
			this._adjustDockPanelLayout(mainDock, currentWidgets);

			// 4. Run synchronized layout updates cascading down the layout trees
			requestAnimationFrame(() =>
			{
				headerRow.fit();
				mainDock.fit();
				workspaceBox.fit();
				windowRoot.update();
				this.resizeTimeout = null;
			});
		}, 100);

	}


	/**
	 * Utility 0: Handle Screen Dimension Collapsing (< 700px check)
	 * Keeps memory cache of multi-pane layout to expand back seamlessly.
	 */
	private _handleResponsiveCollapse(mainDock: DockPanel): void
	{
		const isWidthMobile = window.innerWidth < MOBILEMODE;
		const isHeightMobile = window.innerHeight < TALLSCREEN;
		const isMobileMode = isWidthMobile || isHeightMobile;
		const isWidescreen = window.innerWidth >= WIDESCREEN;
		const isNormal = window.innerWidth >= MOBILEMODE && window.innerWidth < WIDESCREEN;

		// Transitioning into Mobile Mode (< 700px)
		if(isMobileMode && this._isMobileCollapsed !== true)
		{
			// 1. Preserve current expanded layout state in memory
			this._savedLayoutState = mainDock.saveLayout();
			localStorage.setItem('layout_config', JSON.stringify(serializeDockLayout(this._savedLayoutState)));

			// 2. Gather all active widgets
			const allWidgets = Array.from(mainDock.widgets());
			if(allWidgets.length === 0) return;

			// 3. Single container collapse: combine into one single tab group
			const nonOutline = LayoutAdjuster._findNonOutline(mainDock);
			const primaryWidget = nonOutline ?? allWidgets[0];

			// Re-add all other widgets to primary tab container
			allWidgets.forEach((widget) =>
			{
				if(widget === primaryWidget)
				{
					return;
				}
				if(!isWidthMobile && OUTLINE_WIDGET_TYPES.includes(widget.constructor.name))
				{
					return;
				}
				mainDock.activateWidget(widget);
				// Insert alongside primary widget in same tab area
				mainDock.addWidget(widget, { mode: 'tab-after', ref: primaryWidget });
			});

			this._isMobileCollapsed = true;
		}

		// Transitioning back out of Mobile Mode (>= 700px)
		else if(!isMobileMode && this._isMobileCollapsed !== false)
		{
			if(this._savedLayoutState)
			{
				// Restore multi-panel tree from in-memory snapshot
				mainDock.restoreLayout(this._savedLayoutState);
				this._savedLayoutState = null;
			}
			this._isMobileCollapsed = false;
		}


		if(isWidescreen && this._isWidescreenSplit !== true)
		{
			const allWidgets = Array.from(mainDock.widgets());

			if(allWidgets.length > 1)
			{
				// 1. Resolve the primary center editor using project/type target matching
				const primaryWidget = LayoutAdjuster._findNonOutline(mainDock)
					?? allWidgets[0];
				const widgetTypes: Record<string, number> = {};

				allWidgets.forEach(widget =>
				{
					const widgetName = widget.constructor.name;
					const isOutline = OUTLINE_WIDGET_TYPES.includes(widgetName);
					if(isOutline)
					{
						if(!widgetTypes[widget.dataset.type ?? 'outline'])
						{
							widgetTypes[widget.dataset.type ?? 'outline'] = 1;
						} else
						{
							widgetTypes[widget.dataset.type ?? 'outline']++;
						}
					} else
					{
						if(!widgetTypes[widgetName])
						{
							widgetTypes[widgetName] = 1;
						} else
						{
							widgetTypes[widgetName]++;
						}
					}
				});

				// 2. Reference trackers for grouped type splitting
				const firstRefWidget: Record<string, Widget | null> = {

				};

				allWidgets.forEach(widget =>
				{

					const widgetName = widget.constructor.name;
					const isOutline = OUTLINE_WIDGET_TYPES.includes(widgetName);

					if(widget === primaryWidget)
					{
						if(isOutline)
						{
							firstRefWidget['outline'] = widget;
						} else
						{
							firstRefWidget[widgetName] = widget;
						}
						return;
					}

					if(isOutline)
					{
						if(!firstRefWidget['outline'])
						{
							// First file tree / outline splits left relative to main editor
							firstRefWidget['outline'] = widget;
							mainDock.addWidget(widget, { mode: luminoSelf.layoutState?.panels === 'left-hand-files' ? 'split-left' : 'split-right', ref: primaryWidget });
						}
						else
						{
							// Subsequent file trees group as tabs in the outline panel
							mainDock.addWidget(widget, { mode: 'tab-after', ref: firstRefWidget['outline'] });
						}
					}
					else if(widgetName === 'TerminalWidget')
					{
						if(!firstRefWidget[widgetName] && Object.keys(widgetTypes).length <= 2)
						{
							// First terminal splits bottom relative to the primary editor
							firstRefWidget[widgetName] = widget;
							mainDock.addWidget(widget, { mode: luminoSelf.layoutState?.order === 'normal-order' ? 'split-right' : 'split-left', ref: primaryWidget });
						}
						else if(!firstRefWidget[widgetName] && !isHeightMobile)
						{
							firstRefWidget[widgetName] = widget;
							mainDock.addWidget(widget, { mode: luminoSelf.layoutState?.order === 'normal-order' ? 'split-bottom' : 'split-top', ref: primaryWidget });
						}
						else
						{
							// All subsequent terminals dock as tabs next to the first terminal
							mainDock.addWidget(widget, { mode: 'tab-after', ref: firstRefWidget[widgetName] ?? primaryWidget });
						}
					}
					else
					{
						if(!firstRefWidget[widgetName] && (Object.keys(widgetTypes).length <= 2 || Object.keys(firstRefWidget).length < 3))
						{
							// First paint/canvas widget splits right relative to the main editor
							firstRefWidget[widgetName] = widget;
							if(OUTLINE_WIDGET_TYPES.includes(primaryWidget.constructor.name))
							{
								mainDock.addWidget(widget, { mode: luminoSelf.layoutState?.panels === 'left-hand-files' ? 'split-right' : 'split-left', ref: primaryWidget });
							} else
							{
								mainDock.addWidget(widget, { mode: luminoSelf.layoutState?.order === 'normal-order' ? 'split-right' : 'split-left', ref: primaryWidget });
							}
						}
						else
						{
							// Subsequent paint tools group together in the paint split zone
							mainDock.addWidget(widget, { mode: 'tab-after', ref: firstRefWidget[widgetName] ?? primaryWidget });
						}
					}
				});

				// 3. Re-balance fractional sizes across horizontal split areas (20% Outline, 50% Primary, 30% Secondary)
				const layout = mainDock.saveLayout() as unknown as { main: LuminoLayoutNode | null; };
				if(layout?.main?.type === 'split-area' && layout.main.children)
				{
					const count = layout.main.children.length;
					if(widgetTypes['outline'])
					{
						if(count === 2)
						{
							layout.main.sizes = luminoSelf.layoutState?.panels === 'left-hand-files' ? [0.25, 0.75] : [0.75, 0.25];
						}
						else if(count === 3)
						{
							layout.main.sizes = luminoSelf.layoutState?.panels === 'left-hand-files' ? [0.20, 0.40, 0.40] : [0.40, 0.40, 0.20];
						}
					} else
					{
						if(count > 1)
						{
							layout.main.sizes = [0.50, 0.50];
						}
					}
					mainDock.restoreLayout(layout as any);
				}
			}

			this._isWidescreenSplit = true;
		}
		else if(isNormal && this._isWidescreenSplit !== false)
		{
			const allWidgets = Array.from(mainDock.widgets());
			if(allWidgets.length > 1)
			{
				const primaryWidget = LayoutAdjuster._findNonOutline(mainDock)
					?? allWidgets[0];

				const isMobileHeight = window.innerHeight < 700;

				const widgetTypes: Record<string, number> = {};

				allWidgets.forEach(widget =>
				{
					const widgetName = widget.constructor.name;
					const isOutline = OUTLINE_WIDGET_TYPES.includes(widgetName);
					if(isOutline)
					{
						if(!widgetTypes[widget.dataset.type ?? 'outline'])
						{
							widgetTypes[widget.dataset.type ?? 'outline'] = 1;
						} else
						{
							widgetTypes[widget.dataset.type ?? 'outline']++;
						}
					} else
					{
						if(!widgetTypes[widgetName])
						{
							widgetTypes[widgetName] = 1;
						} else
						{
							widgetTypes[widgetName]++;
						}
					}
				});


				const firstRefWidget: Record<string, Widget | null> = {

				};


				allWidgets.forEach(widget =>
				{
					const widgetName = widget.constructor.name;

					if(widget === primaryWidget)
					{
						firstRefWidget[widgetName] = widget;
						return;
					}

					mainDock.activateWidget(widget);

					if(widgetName === 'TerminalWidget')
					{
						// Terminal splitting logic: bottom split if enough height, else collapse to primary tab group
						const nonTerminal = LayoutAdjuster._findNonOutlineOrTerminal(mainDock) ?? primaryWidget;

						if(!firstRefWidget[widgetName] && OUTLINE_WIDGET_TYPES.includes(primaryWidget.constructor.name))
						{
							firstRefWidget[widgetName] = widget;
							mainDock.addWidget(widget, { mode: luminoSelf.layoutState?.panels === 'left-hand-files' ? 'split-right' : 'split-left', ref: nonTerminal ?? primaryWidget });
						}
						else if(!firstRefWidget[widgetName] && !isMobileHeight)
						{
							// First terminal splits below the primary editor / non-terminal container
							firstRefWidget[widgetName] = widget;
							mainDock.addWidget(widget, { mode: luminoSelf.layoutState?.order === 'normal-order' ? 'split-bottom' : 'split-top', ref: nonTerminal });
						}
						else
						{
							mainDock.addWidget(widget, { mode: 'tab-after', ref: firstRefWidget[widgetName] ?? nonTerminal });
						}
					}
					else
					{
						// All other widgets (File lists, Paint tools, Editors) collapse into the primary tab container
						const nonTerminal = LayoutAdjuster._findNonOutlineOrTerminal(mainDock);
						if(OUTLINE_WIDGET_TYPES.includes(widget.constructor.name))
						{
							mainDock.addWidget(widget, {
								mode: firstRefWidget['outline']
									? 'tab-after'
									: luminoSelf.layoutState?.panels === 'left-hand-files'
										? 'split-left' : 'split-right',
								ref: firstRefWidget['outline']
							});
							firstRefWidget['outline'] = widget;
						} else
						{
							mainDock.addWidget(widget, { mode: 'tab-after', ref: firstRefWidget[widgetName] ?? nonTerminal ?? primaryWidget });
							firstRefWidget[widgetName] = widget;
						}
					}
				});

				const layout = mainDock.saveLayout() as unknown as { main: LuminoLayoutNode | null; };
				if(layout?.main?.type === 'split-area' && layout.main.children)
				{
					//const count = layout.main.children.length;
					if(widgetTypes['outline'])
					{
						layout.main.sizes = luminoSelf.layoutState?.panels === 'left-hand-files' ? [0.25, 0.75] : [0.75, 0.25];
					}
					mainDock.restoreLayout(layout as any);
				}
			}

			this._isWidescreenSplit = false;
		}
	}

	/**
	 * Utility 1: Handle UI Visibility, State and Mobile Adaptations
	 */
	private _updateVisibility(workspaceBox: BoxPanel, toolbar: Widget): void
	{
		const isWidescreen = window.innerWidth >= WIDESCREEN;
		const isNormal = window.innerWidth >= MOBILEMODE && window.innerWidth < WIDESCREEN;
		const isMobile = window.innerWidth < MOBILEMODE;
		const isToolbarScrollable = window.innerHeight < TALLSCREEN;

		// 1. ORIGINAL TOOLBAR PARAMETER LOGIC (UNTOUCHED)
		if(isToolbarScrollable)
		{
			toolbar.node.style.minWidth = '60px';
		} else
		{
			toolbar.node.style.minWidth = '50px';
		}

		if(isMobile)
		{
			workspaceBox.direction = 'top-to-bottom';
			toolbar.node.style.display = 'none';
			toolbar.node.style.minWidth = '0px';
		} else
		{
			workspaceBox.direction = 'left-to-right';
			toolbar.node.style.display = 'flex';
		}

		// 2. DYNAMIC REGISTRY VISIBILITY LOGIC (ON GLOBAL WINDOW TOOLBARS)
		const currentClass = luminoSelf.lastInteractedWidget?.constructor.name || '';
		const previousClass = luminoSelf.previousInteractedWidget?.constructor.name || '';

		ALL_TOOLBARS.forEach((key) =>
		{
			const globalToolbar = luminoSelf[key];
			if(!globalToolbar || !globalToolbar.node) return;

			const allowedWidgets = TOOLBAR_CONTEXT_MAP[key] || [];
			const isNeededByCurrent = allowedWidgets.includes(currentClass);
			const isNeededByPrevious = allowedWidgets.includes(previousClass);

			let dynamicContextMatch = isNeededByCurrent;
			if(isWidescreen && !dynamicContextMatch)
			{
				dynamicContextMatch ||= isNeededByPrevious;
			}

			if(isMobile)
			{
				globalToolbar.node.style.display = 'none';
				globalToolbar.node.style.minWidth = '0px';
			} else
			{
				if(dynamicContextMatch)
				{
					globalToolbar.node.style.display = 'contents';
				} else
				{
					globalToolbar.node.style.display = 'none';
				}
			}
		});
	}


	/**
	 * Utility 2: Dynamic Scroll Height Profiler (Fixes the wrapping clipping bug)
	 */
	private _recalculateToolbarHeight(headerRow: Panel): void
	{
		// Clear old inline styles to allow natural text wrapping evaluations
		headerRow.node.style.minHeight = '';
		headerRow.node.style.height = '';

		// Grab the actual rendered height required by CSS flex-wrap
		const currentNeededHeight = headerRow.node.scrollHeight;

		// Update headerRow constraints if your layouts restrict it
		headerRow.node.style.minHeight = `${currentNeededHeight + 10}px`;
		headerRow.update();


	}

	/**
	 * Utility 2: Dynamic Scroll Height Profiler (Fixes the wrapping clipping bug)
	 * Iterates through all tab bars inside the DockPanel and dynamically scales heights.
	 */
	private async _recalculateDockTabHeights(dockPanel: DockPanel): Promise<void>
	{
		// Find all active tab bar elements within the entire dock panel workspace
		const tabBars = dockPanel.node.querySelectorAll('.lm-TabBar');

		tabBars.forEach((tabBarElement) =>
		{
			const tabBarNode = tabBarElement as HTMLElement;
			const tabBarContent = tabBarElement.querySelector('.lm-TabBar-content') as HTMLElement;
			if(!tabBarContent)
			{
				return;
			}

			// 1. Clear old inline style overrides to permit clean multi-row rendering calculations
			tabBarContent.style.minHeight = '';
			tabBarContent.style.height = 'auto';
			tabBarNode.style.minHeight = '';
			tabBarNode.style.height = 'auto';
		});


		await new Promise<void>(resolve =>
		{
			window.requestAnimationFrame(() =>
			{
				tabBars.forEach((tabBarElement) =>
				{
					const tabBarNode = tabBarElement as HTMLElement;
					const tabBarContent = tabBarElement.querySelector('.lm-TabBar-content') as HTMLElement;
					const naturalHeight = Math.ceil(tabBarContent.getBoundingClientRect().height);
					tabBarContent.style.minHeight = `${naturalHeight}px`;
					tabBarNode.style.minHeight = `${naturalHeight}px`;
				});

				// 4. Force Lumino to recalculate and distribute the absolute coordinates
				// of the sub-panels based on the updated DOM heights
				dockPanel.update();
				resolve();
			});
		});
	}


	/**
	 * Utility 3: Tree Split Area Layout Size Allocation
	 */
	private _adjustDockPanelLayout(mainDock: DockPanel, currentWidgets: any[]): void
	{
		if(/*currentWidgets.length <= this._prevWidgetCount ||*/ this.alreadyResizing)
		{
			this._prevWidgetCount = currentWidgets.length;
			return;
		}
		this.alreadyResizing = true;

		const layout = mainDock.saveLayout() as unknown as { main: LuminoLayoutNode | null; };
		if(!layout || !layout.main)
		{
			this._prevWidgetCount = currentWidgets.length;
			return;
		}

		this._prevWidgetCount = currentWidgets.length;

		// 1. Gather file list widget targets
		const targetIds = this._extractTargetWidgetIds(currentWidgets);
		console.log('Resizing file list target: ' + targetIds.size);

		if(targetIds.size > 0)
		{
			const totalWidth = mainDock.node.clientWidth || 800;
			const totalHeight = mainDock.node.clientHeight || 600;

			const rootOrientation = layout.main.orientation || 'horizontal';
			const initialSpace = rootOrientation === 'horizontal' ? totalWidth : totalHeight;

			// 2. Execute the recursive layout size mutations
			LayoutAdjuster.handleResponsiveLayoutCollapse(mainDock);
			this._traverseAndAdjustSizes(layout.main, initialSpace, targetIds);

			// 3. Flush layout modifications back to the dock
			mainDock.restoreLayout(layout as any);
		}

		this.alreadyResizing = false;
	}

	/**
	 * Filter and extract active targets safely
	 */
	private _extractTargetWidgetIds(widgets: any[]): Set<string>
	{
		const targetIds = new Set<string>();
		widgets.forEach(widget =>
		{
			if(OUTLINE_WIDGET_TYPES.includes(widget.constructor.name))
			{
				targetIds.add(widget.id);
			}
		});
		return targetIds;
	}

	/**
	 * Recursive layout node walker that maps dimensions down the node tree branches
	 */
	private _traverseAndAdjustSizes(node: LuminoLayoutNode, availablePixelSpace: number, targetIds: Set<string>): void
	{
		if(node.type === 'split-area' && node.children)
		{
			// FIX: If sizes array is missing or unpopulated, initialize it to equal shares
			if(!node.sizes || node.sizes.length !== node.children.length)
			{
				node.sizes = new Array(node.children.length).fill(1 / node.children.length);
			}

			let targetIndex = -1;

			// Locate which split slot sibling branch contains our matching view frame
			node.children.forEach((child, index) =>
			{
				if(this._containsTargetWidget(child, targetIds))
				{
					targetIndex = index;
				}
			});

			// Mutate fractional scales for this split boundary layout inline
			if(targetIndex !== -1)
			{
				node.sizes = this._calculateProportionalSizes(node.sizes, targetIndex, availablePixelSpace);
			}

			// Bubble allocations downward to deep sub-splits
			node.children.forEach((child, index) =>
			{
				const childRatio = node.sizes![index]; // Guaranteed to exist now
				const childPixels = availablePixelSpace * childRatio;
				this._traverseAndAdjustSizes(child, childPixels, targetIds);
			});
		}
		else if(node.children)
		{
			node.children.forEach(child => this._traverseAndAdjustSizes(child, availablePixelSpace, targetIds));
		}
	}

	/**
	 * Deep recursive checker to locate specific layout leaf widgets
	 */
	private _containsTargetWidget(node: LuminoLayoutNode, ids: Set<string>): boolean
	{
		if(node.type === 'tab-area' && node.widgets)
		{
			return node.widgets.some(wRef =>
			{
				const id = typeof wRef === 'string' ? wRef : wRef.id;
				return ids.has(id);
			});
		}
		if(node.children)
		{
			return node.children.some(child => this._containsTargetWidget(child, ids));
		}
		return false;
	}

	/**
	 * Mathematical normalization strategy that preserves a 1.0 sum across siblings
	 */
	private _calculateProportionalSizes(sizes: number[], targetIndex: number, availableSpace: number): number[]
	{
		// Sanity check: If zero or negative space is available (hidden/collapsed view), abort mutation
		if(availableSpace <= 0 || isNaN(availableSpace) || !isFinite(availableSpace))
		{
			return sizes;
		}

		const targetRatio = Math.min(200 / availableSpace, 0.8);

		// Safety check: prevent an impossible ratio break
		if(targetRatio >= 1 || targetRatio <= 0)
		{
			return sizes;
		}

		const currentTargetRatio = sizes[targetIndex];
		const remainingRatioBefore = 1 - currentTargetRatio;
		const remainingRatioAfter = 1 - targetRatio;

		// Guard against negative ratio remaining space bounds
		if(remainingRatioAfter <= 0 || remainingRatioBefore <= 0)
		{
			return sizes;
		}

		return sizes.map((size, index) =>
		{
			if(index === targetIndex) return targetRatio;
			if(remainingRatioBefore > 0)
			{
				return (size / remainingRatioBefore) * remainingRatioAfter;
			}
			return remainingRatioAfter / (sizes.length - 1);
		});
	}
}

export function isDevToolsOpen(): boolean
{
	const threshold = 160; // Cushion for window borders

	const widthThreshold = window.outerWidth - window.innerWidth > threshold;
	const heightThreshold = window.outerHeight - window.innerHeight > threshold;

	const hasClass = document.body?.classList.contains('debugger') ?? false;
	const debuggerIsOpen = widthThreshold || heightThreshold;

	if(document.body)
	{
		if(debuggerIsOpen && !hasClass)
		{
			document.body.classList.add('debugger');
		} else if(!debuggerIsOpen && hasClass)
		{
			document.body.classList.remove('debugger');
		}
	}

	return debuggerIsOpen;
}


export function updateModifierPressed(e: KeyboardEvent)
{
	luminoSelf.isModifierPressed = e.ctrlKey || e.metaKey;
	luminoSelf.isShiftPressed = e.shiftKey;

	const hasClass = document.body.classList.contains('modifier');

	// TODO: set engine to 1 FPS if debugger is open, not only because it runs
	//   slower but the nature of debugging is seeing the frames
	if(!luminoSelf.isModifierPressed && hasClass)
		document.body.classList.remove('modifier');
	if(luminoSelf.isModifierPressed && !hasClass)
		document.body.classList.add('modifier');


	const hasShift = document.body.classList.contains('shift');
	if(!luminoSelf.isShiftPressed && hasShift)
		document.body.classList.remove('shift');
	if(luminoSelf.isShiftPressed && !hasShift)
		document.body.classList.add('shift');


	isDevToolsOpen();
}

luminoSelf.updateModifierPressed = updateModifierPressed;


export function serializeDockLayout(config: any): SafeDockLayoutConfig
{
	if(!config) return { main: null };

	const cleanNode = (node: any): SafeLayoutNode =>
	{
		const copy: SafeLayoutNode = { type: node.type };

		if(node.orientation) copy.orientation = node.orientation;
		if(node.sizes) copy.sizes = [...node.sizes];
		if(typeof node.currentIndex === 'number') copy.currentIndex = node.currentIndex;

		if(node.children && Array.isArray(node.children))
		{
			copy.children = node.children.map(cleanNode);
		}

		if(node.widgets && Array.isArray(node.widgets))
		{
			copy.widgets = node.widgets.map((w: any) =>
			{
				// Extract unique string ID from Widget object or fallback string
				return typeof w === 'string' ? w : w.id;
			});
		}

		return copy;
	};

	return {
		main: config.main ? cleanNode(config.main) : null
	};
}

/**
 * Re-hydrates string IDs back into live Widget instances from the active DockPanel
 */
export function deserializeDockLayout(
	safeConfig: SafeDockLayoutConfig,
	activeWidgets: any[]
): any
{
	if(!safeConfig || !safeConfig.main) return null;

	// Map active widgets by ID for quick lookup
	const widgetMap = new Map<string, any>();
	activeWidgets.forEach(w =>
	{
		if(w && w.id) widgetMap.set(w.id, w);
	});

	const restoreNode = (node: SafeLayoutNode): any =>
	{
		const restored: any = { type: node.type };

		if(node.orientation) restored.orientation = node.orientation;
		if(node.sizes) restored.sizes = [...node.sizes];
		if(typeof node.currentIndex === 'number') restored.currentIndex = node.currentIndex;

		if(node.children)
		{
			restored.children = node.children.map(restoreNode);
		}

		if(node.widgets)
		{
			// Convert string IDs back to actual live Widget instances
			restored.widgets = node.widgets
				.map(id => widgetMap.get(id))
				.filter(Boolean); // Drop missing/disposed widgets
		}

		return restored;
	};

	return {
		main: restoreNode(safeConfig.main)
	};
}

