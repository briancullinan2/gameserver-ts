import { DockPanel, Menu, Widget } from '@lumino/widgets';
import { OUTLINE_WIDGET_TYPES } from './lumino-resize';
import type { LuminoLayoutWindow } from './lumino.d';
import type { GlobalToolbarsWindow, LuminoMenuWindow } from './menu.d';
import type { AceEditorWidget } from '../editor/widget';
import type { TerminalWidget } from '../terminal/widget';
import { historyToolbar } from './menu-history';
import { MODULE_REGISTRY, TERMINAL_REGISTRY, TOOLS_REGISTRY } from './menu';
import { SHORT_NAME } from './global';
import type { EditorWindow } from '../editor/widget.d';

export const WIDESCREEN = 1200;
export const MOBILEMODE = 600;
export const TALLSCREEN = 700;


const luminoSelf: EditorWindow & LuminoLayoutWindow & LuminoMenuWindow & GlobalToolbarsWindow = self as unknown as any;

// Define strict types for our layout configuration
export type WidgetType = 'editor' | 'outline' | 'terminal' | 'sidebar';

export interface LayoutOptions
{
	type: WidgetType;
	projectId?: string;
	activate?: boolean;
	resize?: boolean;
}

// Global tracking structures
const trackedWidgets = new WeakSet<Widget>();

/**
 * Global tracker function to handle focus and clicks safely on Lumino elements.
 */
function trackWidgetInteraction(widget: Widget): void
{
	if(!widget || !widget.node || trackedWidgets.has(widget))
	{
		return;
	}

	const registerSelection = (): void =>
	{
		const newType = widget?.constructor.name;
		const lastType = luminoSelf.lastInteractedWidget?.constructor.name;

		if(newType !== lastType)
		{
			luminoSelf.previousInteractedWidget = luminoSelf.lastInteractedWidget;
			luminoSelf.lastInteractedWidget = widget;

			updateHashFromWidget(widget);
		}

		console.log('Focused: ' + luminoSelf.lastInteractedWidget?.constructor.name + ' unFocused: ' + luminoSelf.previousInteractedWidget?.constructor.name);
		luminoSelf.resizeHandler?.();
	};

	widget.node.addEventListener('focusin', registerSelection);
	widget.node.addEventListener('mousedown', registerSelection);

	trackedWidgets.add(widget);
}



export function updateHashFromWidget(shownWidget: Widget)
{
	if(luminoSelf.renderingHashCommand)
	{
		return;
	}
	const widgetTypeName = shownWidget.constructor.name;
	if(widgetTypeName === 'AceEditorWidget')
	{
		const aceEditor = shownWidget as AceEditorWidget;
		historyToolbar.recordFileHistory(aceEditor.fileId, void 0, (aceEditor._editor?.getCursorPosition().row ?? 0) + 1);
	} else if(widgetTypeName === 'TerminalWidget')
	{
		const filterId = (shownWidget as TerminalWidget).filterId;
		const terminal = TERMINAL_REGISTRY.find(t => t.id === filterId);
		const title = `${(terminal?.label ?? 'Terminal')} · ${SHORT_NAME}`;
		document.title = title;
		history.pushState({ location: '/#' + filterId, title: title }, title, '#' + filterId);
	} else // if(OUTLINE_WIDGET_TYPES.includes(widgetTypeName))
	{
		const widgetKey = Object.keys(MODULE_REGISTRY).find(key => MODULE_REGISTRY[key].className === widgetTypeName)
			?? Object.keys(TOOLS_REGISTRY).find(key => TOOLS_REGISTRY[key].className === widgetTypeName);
		if(widgetKey)
		{
			const title = `${widgetKey ? (MODULE_REGISTRY[widgetKey]?.label ?? TOOLS_REGISTRY[widgetKey]?.label) : shownWidget.title.label} · ${SHORT_NAME}`;
			document.title = title;
			history.pushState({ location: '/#' + widgetKey, title: title }, title, '#' + widgetKey);
		}
	}
}


/**
 * Smart Layout Orchestrator wrapper for Lumino DockPanel in TypeScript
 */
export class LayoutAdjuster
{
	/**
	 * Main entry point to add a widget using your interactive ranking system
	 */
	public static addOptimalWidgetLayout(
		dockPanel: DockPanel,
		newWidget: Widget,
		options: LayoutOptions = { type: 'editor' }
	): void
	{
		const type = options.type;
		const projectId = options.projectId || '';
		const shouldActivate = options.activate !== false;
		const shouldResize = options.resize !== false;

		// Track interactions on the new widget moving forward
		trackWidgetInteraction(newWidget);

		const HTMLElement = newWidget.node as HTMLElement;
		// Safely apply metadata to DOM dataset for responsive query selection later
		HTMLElement.dataset.projectId = projectId;
		HTMLElement.dataset.type = type;

		const menuExists = luminoSelf.tabsMenu?.items.some(
			(existing) => existing.args.value === newWidget.id
		);
		if(!menuExists)
		{
			const insertedMenuItem = luminoSelf.tabsMenu?.insertItem(0, {
				command: 'select-tab', args: { value: newWidget.id, label: newWidget.title.label }
			});
		}

		// --- BRANCH 1: TERMINAL LAYOUT ---
		if(type === 'terminal')
		{
			const existingTerminal = this._findBestEditorForProject(dockPanel, projectId, type);
			const lastNonOutline = this._findNonOutline(dockPanel);
			const isTallscreen = window.innerHeight >= TALLSCREEN;
			if(lastNonOutline && isTallscreen && !existingTerminal)
			{
				dockPanel.addWidget(newWidget, {
					mode: luminoSelf.layoutState?.order === 'normal-order' ? 'split-bottom' : 'split-top',
					ref: lastNonOutline ?? luminoSelf.lastInteractedWidget ?? undefined
				});
			} else if(lastNonOutline || existingTerminal)
			{
				dockPanel.addWidget(newWidget, {
					mode: 'tab-after',
					ref: existingTerminal ?? lastNonOutline ?? luminoSelf.lastInteractedWidget ?? undefined
				});
			} else
			{
				dockPanel.addWidget(newWidget, {
					mode: luminoSelf.layoutState?.panels === 'left-hand-files' ? 'split-right' : 'split-left'
				});
			}
			requestAnimationFrame(() =>
			{
				if(shouldActivate)
				{
					dockPanel.activateWidget(newWidget);
					newWidget.fit();
					newWidget.update();
				}
				if(shouldResize)
				{
					luminoSelf.resizeHandler?.();
				}
			});
			return;
		}

		// --- BRANCH 2: OUTLINE VIEW ---
		if(type === 'outline')
		{
			const targetRef = this._findBestEditorForProject(dockPanel, projectId, type);
			if(targetRef)
			{
				dockPanel.addWidget(newWidget, {
					mode: 'tab-after',
					ref: targetRef
				});
			} else
			{
				dockPanel.addWidget(newWidget, { mode: luminoSelf.layoutState?.panels === 'left-hand-files' ? 'split-left' : 'split-right' });
			}
			requestAnimationFrame(() =>
			{
				if(shouldActivate)
				{
					dockPanel.activateWidget(newWidget);
					newWidget.fit();
					newWidget.update();
				}
				if(shouldResize)
				{
					luminoSelf.resizeHandler?.();
				}

			});
			return;
		}

		// --- BRANCH 3: THE CORE EDITOR / PROJECT TAB RANKING SYSTEM ---
		if(type === 'editor')
		{
			const isWidescreen = window.innerWidth >= WIDESCREEN;
			const isTallscreen = window.innerHeight >= TALLSCREEN;
			if(isWidescreen)
			{
				HTMLElement.dataset.layoutGroup = 'split-column';
			} else
			{
				HTMLElement.dataset.layoutGroup = 'original-main';
			}

			const bestRef = this._findRankedReference(dockPanel, projectId);
			const splitOrder = luminoSelf.layoutState?.order === 'normal-order' ? 'split-top' : 'split-bottom';
			const splitFiles = luminoSelf.layoutState?.panels === 'left-hand-files' ? 'split-right' : 'split-left';

			if(bestRef && bestRef.dataset?.type === 'terminal')
			{
				const shouldSplit = (isTallscreen && bestRef.dataset.projectId !== projectId);
				dockPanel.addWidget(newWidget, {
					mode: shouldSplit ? splitOrder : 'tab-after',
					ref: bestRef
				});
			}
			else if(bestRef)
			{
				const refHTMLElement = bestRef.node as HTMLElement;
				const shouldSplit = (isWidescreen && refHTMLElement.dataset.projectId !== projectId)
					|| refHTMLElement.dataset.type === 'outline';
				console.log('Opening tab:' + newWidget.constructor.name + ' ' + (shouldSplit ? splitFiles : 'tab-after') + ' ' + bestRef.constructor.name);
				dockPanel.addWidget(newWidget, {
					mode: shouldSplit ? splitFiles : 'tab-after',
					ref: bestRef
				});
			} else if(isWidescreen)
			{
				console.log('Opening tab split-right');
				dockPanel.addWidget(newWidget, { mode: splitFiles });
			} else
			{
				console.log('Opening tab-after');
				dockPanel.addWidget(newWidget, { mode: 'tab-after' });
			}
			requestAnimationFrame(() =>
			{
				if(shouldActivate)
				{
					dockPanel.activateWidget(newWidget);
					newWidget.fit();
					newWidget.update();
				}
				if(shouldResize)
				{
					luminoSelf.resizeHandler?.();
				}
			});
			return;
		}

		// Default Fallback
		dockPanel.addWidget(newWidget, {
			mode: 'tab-after',
			ref: luminoSelf.lastInteractedWidget ?? undefined
		});
		requestAnimationFrame(() =>
		{
			if(shouldActivate)
			{
				dockPanel.activateWidget(newWidget);
				newWidget.fit();
				newWidget.update();
			}
			if(shouldResize)
			{
				luminoSelf.resizeHandler?.();
			}
		});
	}


	public static _findNonOutline(dockPanel: DockPanel): Widget | null
	{

		const iterator = dockPanel.widgets();
		let current = iterator.next();
		while(current && current.value)
		{
			const el = current.value.node as HTMLElement;
			if(!OUTLINE_WIDGET_TYPES.includes(el.dataset?.projectId ?? current.value.constructor.name))
			{
				return current.value;
			}
			current = iterator.next();
		}
		return null;
	}

	public static _findNonOutlineOrTerminal(dockPanel: DockPanel): Widget | null
	{

		const iterator = dockPanel.widgets();
		let current = iterator.next();
		while(current && current.value)
		{
			const el = current.value.node as HTMLElement;
			if(!OUTLINE_WIDGET_TYPES.includes(el.dataset?.projectId ?? current.value.constructor.name)
				&& current.value.constructor.name !== 'TerminalWidget')
			{
				return current.value;
			}
			current = iterator.next();
		}
		return null;
	}

	/**
	 * Ranks existing widgets to find the optimal reference sibling.
	 */
	private static _findRankedReference(dockPanel: DockPanel, projectId: string): Widget | null
	{
		// Rank 1: Check last global interaction
		if(luminoSelf.lastInteractedWidget && luminoSelf.lastInteractedWidget.isAttached)
		{
			const lastEl = luminoSelf.lastInteractedWidget.node as HTMLElement;
			if(lastEl.dataset?.projectId === projectId)
			{
				return luminoSelf.lastInteractedWidget;
			}
		}

		// Rank 2: Scan for the largest existing project match
		let largestProjectWidget: Widget | null = null;
		let maxArea = -1;
		let maxAreaNotFiles = -1;

		const iterator = dockPanel.widgets();
		let current = iterator.next();
		let notFiles = null;

		while(current && current.value)
		{
			const w = current.value;
			const el = w.node as HTMLElement;

			if(el.dataset?.projectId === projectId)
			{
				const rect = el.getBoundingClientRect();
				const area = rect.width * rect.height;
				if(area > maxArea)
				{
					maxArea = area;
					largestProjectWidget = w;
				}
			} else if(!OUTLINE_WIDGET_TYPES.includes(w.constructor.name))
			{
				const rect = el.getBoundingClientRect();
				const area = rect.width * rect.height;
				if(area > maxAreaNotFiles)
				{
					maxAreaNotFiles = area;
					notFiles = w;
				}
			}
			current = iterator.next();
		}

		if(largestProjectWidget)
		{
			return largestProjectWidget;
		}

		if(notFiles)
		{
			return notFiles;
		}

		// Rank 3: Fallback to whatever was last touched globally
		if(luminoSelf.lastInteractedWidget && luminoSelf.lastInteractedWidget.isAttached)
		{
			return luminoSelf.lastInteractedWidget;
		}

		return null;
	}

	/**
	 * Helper to look up an editor matching a specific project context
	 */
	public static _findBestEditorForProject(dockPanel: DockPanel, projectId: string | null | undefined, type: string): Widget | null
	{
		let fallbackType: Widget | null = null;
		if(luminoSelf.lastInteractedWidget && luminoSelf.lastInteractedWidget.isAttached)
		{
			const lastEl = luminoSelf.lastInteractedWidget.node as HTMLElement;
			if(lastEl.dataset?.projectId === projectId)
			{
				return luminoSelf.lastInteractedWidget;
			}
			if(lastEl.dataset?.type === type)
			{
				fallbackType = luminoSelf.lastInteractedWidget;
			}
		}

		const iterator = dockPanel.widgets();
		let current = iterator.next();
		while(current && current.value)
		{
			const el = current.value.node as HTMLElement;
			if(el.dataset?.projectId === projectId)
			{
				return current.value;
			}
			if(el.dataset?.type === type)
			{
				fallbackType = current.value;
			}
			current = iterator.next();
		}

		if(fallbackType)
		{
			return fallbackType;
		}

		return null;
	}

	/**
	 * Responsive window compression layout flattener
	 */
	public static handleResponsiveLayoutCollapse(dockPanel: DockPanel): void
	{
		const isWidescreen = window.innerWidth >= WIDESCREEN;
		if(isWidescreen) return;

		const iterator = dockPanel.widgets();
		let current = iterator.next();

		const splitWidgets: Widget[] = [];
		let mainGroupRef: Widget | null = null;

		while(current && current.value)
		{
			const w = current.value;
			const el = w.node as HTMLElement;

			if(el.dataset?.layoutGroup === 'split-column')
			{
				splitWidgets.push(w);
			} else if(el.dataset?.layoutGroup === 'original-main' && !mainGroupRef)
			{
				mainGroupRef = w;
			}
			current = iterator.next();
		}

		if(mainGroupRef && splitWidgets.length > 0)
		{
			splitWidgets.forEach(w =>
			{
				const el = w.node as HTMLElement;
				el.dataset.layoutGroup = 'original-main';
				dockPanel.addWidget(w, {
					mode: 'tab-after',
					ref: mainGroupRef!
				});
			});
		}
	}
}

luminoSelf.LayoutAdjuster = LayoutAdjuster;

