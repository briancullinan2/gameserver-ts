import type { SettingConfig } from '../bundle/settings';
import { Widget } from '@lumino/widgets';
import { Terminal } from '@xterm/xterm';
import { TerminalEventManager } from './events';
import { SearchTerminal } from './search';
import { FrameRater } from '../bundle/frame-rater';
import type { IPooledTerminal } from './widget-types';
import type { TerminalWindow } from './widget.d';
import type { LuminoLayoutWindow } from '../bundle/lumino.d';
import type { GlobalToolbarsWindow, RepositorySettingsWindow } from '../bundle/menu.d';

const LINES_TO_SCROLLBACK = 5000;

const terminalSelf: TerminalWindow & LuminoLayoutWindow & GlobalToolbarsWindow
	& RepositorySettingsWindow = self as unknown as any;

terminalSelf.terminalFrameLimiter = new FrameRater(25, (e, t, frame) =>
{

	for(const pooled of TerminalPoolManager.getInstance().pool.values())
	{
		if(pooled.activeOwner)
		{
			pooled.term.refresh(0, pooled.term.rows - 1);
			const core = (pooled.term as any)._core;
			if(core && core._renderService)
			{
				// Flushes whatever rows were marked dirty by term.refresh()
				core._renderService._renderRows();
			}
		}
	}

	terminalSelf.terminalFrameLimiter?.requestFrameUpdate();
});


/**
 * Global coordinator managing terminal resource allocation across dock layout splits.
 */
class TerminalPoolManager
{
	private static instance: TerminalPoolManager;
	public pool: Map<string, IPooledTerminal> = new Map();
	private instanceCounter = 0;

	private readonly SCRIPTS_TO_LOAD = [
		'/components/terminal/commands-build.js',
		'/components/terminal/commands-files.js',
		'/components/terminal/commands-git.js',
		'/components/terminal/commands-quake3.js',
		'/components/terminal/commands.js',
	];
	startupPromise: Promise<void>;

	private constructor()
	{

		this.startupPromise = (async () =>
		{
			for(let src of this.SCRIPTS_TO_LOAD)
			{
				await terminalSelf.loadScript?.(src);
			}

			terminalSelf.terminalFrameLimiter?.requestFrameUpdate();
		})();
		window.addEventListener('beforeunload', () =>
		{
			for(const pooled of this.pool.values())
			{
				pooled.term.dispose();
			}
		});
	}

	public count(): Number
	{
		return this.pool.size;
	}

	public static getInstance(): TerminalPoolManager
	{
		if(!TerminalPoolManager.instance)
		{
			TerminalPoolManager.instance = new TerminalPoolManager();
		}
		return TerminalPoolManager.instance;
	}

	/**
	 * Allocates an available terminal from the pool or spawns a new one
	 * if all existing sessions are currently occupied by visible widgets.
	 */
	public acquireTerminal(widget: TerminalWidget): IPooledTerminal
	{
		// First, check if there is an unowned terminal session we can recycle
		for(const pooled of this.pool.values())
		{
			if(!pooled.activeOwner || pooled.activeOwner === widget)
			{
				pooled.activeOwner = widget;
				return pooled;
			}
		}

		// Allocate a fresh session if layout splits force simultaneous rendering
		this.instanceCounter++;
		const terminalId = `term-session-${this.instanceCounter}`;

		const container = document.createElement('div');
		container.className = 'terminal-instance-container';
		container.style.width = '100%';
		container.style.height = '100%';

		const term = new Terminal({
			allowProposedApi: true,
			convertEol: true,
			scrollback: LINES_TO_SCROLLBACK,
			cursorBlink: true
		});

		term.open(container);

		const resizeObserver = new ResizeObserver(() =>
		{
			if(widget.isVisible && pooledContext.activeOwner === widget)
			{
				this.fitTerminalLayout(pooledContext);
			}
		});
		resizeObserver.observe(container);

		const pooledContext: IPooledTerminal = {
			id: terminalId,
			term,
			container,
			resizeObserver,
			activeOwner: widget,
		};
		pooledContext.events = new TerminalEventManager(pooledContext, container);

		this.pool.set(terminalId, pooledContext);

		return pooledContext;
	}

	/**
	 * Releases a widget's ownership claim over a terminal session.
	 */
	public releaseTerminal(widget: TerminalWidget): void
	{
		for(const pooled of this.pool.values())
		{
			if(pooled.activeOwner === widget)
			{
				pooled.activeOwner = null;
				if(pooled.container.parentNode)
				{
					pooled.container.parentNode.removeChild(pooled.container);
				}
			}
		}
	}

	/**
	 * Forces character measurement metrics and resizes the xterm viewport dimensions.
	 */
	public fitTerminalLayout(pooled: IPooledTerminal): void
	{
		const term = pooled.term;
		const container = pooled.container;
		const core = (term as any)._core;

		if(!core || container.clientWidth === 0 || container.clientHeight === 0)
		{
			return;
		}

		if(core._charSizeService && !core._charSizeService.hasValidSize)
		{
			core._charSizeService.measure();
		}

		const dims = core._renderService && core._renderService.dimensions;
		if(!dims || dims.css.cell.width === 0 || dims.css.cell.height === 0)
		{
			return;
		}

		const cols = Math.max(120, Math.floor(container.clientWidth / dims.css.cell.width));
		const rows = Math.max(1, Math.floor(container.clientHeight / dims.css.cell.height));
		terminalSelf.mostRecentTerminalCols = cols;
		term.resize(cols, rows);
	}
}

if(!terminalSelf.terminalWidgets)
{
	terminalSelf.terminalWidgets = new Array<TerminalWidget>();
}

/**
 * Lumino Component displaying specialized logs driven by a centralized terminal context pool.
 */
export class TerminalWidget extends Widget
{
	public filterId: string;
	public currentTerminalCtx: IPooledTerminal | null = null;
	private parentTabBar?: HTMLElement;

	constructor(filterId: string, titleLabel: string)
	{
		super();
		if(filterId === 'Show Console')
		{
			this.filterId = terminalSelf.TERMINAL_REGISTRY?.[0].id ?? 'all';
			this.id = `terminal-panel-${this.filterId}`;
			this.title.className = this.id;
			this.title.label = terminalSelf.TERMINAL_REGISTRY?.[0].label ?? 'Terminal Logs';
		} else
		{
			this.filterId = filterId;
			this.id = `terminal-panel-${filterId}`;
			this.title.className = this.id;
			this.title.label = titleLabel;
		}
		this.title.closable = true;
		this.dataset.type = 'terminal';
		this.addClass('terminal-filter-widget');

		if(terminalSelf.terminalWidgets)
		{
			terminalSelf.terminalWidgets[terminalSelf.terminalWidgets.length] = this;
		}

		terminalSelf.settingsManager?.hydrateAll(LOCAL_SETTINGS.editor);
	}


	private createSearchElement(): void
	{
		if(!this.currentTerminalCtx || this.currentTerminalCtx.searchContainer)
		{
			return;
		}
		this.currentTerminalCtx.searchContainer = document.createElement('div');
		this.currentTerminalCtx.searchContainer.className = 'lumino-tab-search-wrapper';
		// Start hidden until onAfterShow fires
		this.currentTerminalCtx.searchContainer.style.display = 'none';

		this.currentTerminalCtx.searchInput = document.createElement('input');
		this.currentTerminalCtx.searchInput.type = 'search';
		this.currentTerminalCtx.searchInput.id = 'search-terminal';
		this.currentTerminalCtx.searchInput.placeholder = 'Search...';
		this.currentTerminalCtx.searchInput.autocomplete = 'off';

		this.currentTerminalCtx.searchInput.addEventListener('keypress', event =>
		{
			if(event.key === 'Enter')
			{
				event.preventDefault();
			}

			if(!this.currentTerminalCtx)
			{
				return;
			}

			SearchTerminal.executeFindQuery(this.currentTerminalCtx, event);
		});
		this.currentTerminalCtx.searchContainer.appendChild(this.currentTerminalCtx.searchInput);
		this.currentTerminalCtx.searchObserver = new ResizeObserver((entries) =>
		{
			//for(const entry of entries)
			//{
			//const { width, height } = entry.contentRect;
			//}
			this.resizeSearchContainer();
		});
		this.currentTerminalCtx.searchObserver.observe(this.node);
	}


	/**
	 * Triggered by Lumino lifecycle manager when the tab layout brings this item into view.
	 */
	protected onAfterShow(msg: any): void
	{
		super.onAfterShow(msg);
		this.claimAndRenderSession();
		this.createSearchElement();
		window.requestAnimationFrame(() =>
		{
			this.showSearchBar();
		});
	}

	private resizeSearchContainer = () =>
	{
		const parentTabBar = this.node.closest('.lm-DockPanel, .lm-TabPanel')?.querySelector(`.lm-TabBar:has(li.${this.id})`) as HTMLElement;

		//console.log('search bar: ', parentTabBar, this.searchContainer, this.searchContainer.style.display);

		if(!parentTabBar || !this.currentTerminalCtx
			|| !this.currentTerminalCtx.searchContainer
			|| this.currentTerminalCtx.searchContainer.style.display === 'none')
		{
			return;
		}
		if(parentTabBar !== this.parentTabBar)
		{
			this.parentTabBar = parentTabBar;
			this.parentTabBar?.appendChild(this.currentTerminalCtx.searchContainer);
		}


		// Ensure searchContainer doesn't push the tab bar layout around
		this.currentTerminalCtx.searchContainer.style.position = 'absolute';
		this.currentTerminalCtx.searchContainer.style.right = '0px';

		const totalWidth = parentTabBar.getBoundingClientRect().width;
		let occupiedWidth = 0;

		// Target the actual tab items (typically 'li' elements with the class '.lm-TabBar-tab')
		// instead of the full-width wrapper panels.
		const actualTabs = parentTabBar.querySelectorAll('.lm-TabBar-content li');

		actualTabs.forEach((tab) =>
		{
			const element = tab as HTMLElement;
			const rect = element.getBoundingClientRect();

			const style = window.getComputedStyle(element);
			const margins = parseFloat(style.marginLeft || '0') + parseFloat(style.marginRight || '0');
			const elementTotalWidth = rect.width + margins;

			// If adding this element exceeds the available row width, it wraps to a new row.
			// We reset the row's occupied width tracking back to 0 before adding this element.
			if(occupiedWidth + elementTotalWidth > totalWidth && occupiedWidth > 0)
			{
				occupiedWidth = 0;
			}

			occupiedWidth += elementTotalWidth;
		});

		// Handle any extra functional sibling controls (like scroll buttons if present)
		const extraControls = parentTabBar.querySelectorAll('.lm-TabBar-scrollButton');
		extraControls.forEach((control) =>
		{
			const element = control as HTMLElement;
			const rect = element.getBoundingClientRect();
			const elementTotalWidth = rect.width;

			if(occupiedWidth + elementTotalWidth > totalWidth && occupiedWidth > 0)
			{
				occupiedWidth = 0;
			}

			occupiedWidth += elementTotalWidth;
		});

		// Set max-width based on the remaining space on the final row line
		const remainingSpace = Math.max(0, totalWidth - occupiedWidth - 15);
		this.currentTerminalCtx.searchContainer.style.maxWidth = `${remainingSpace}px`;
	};

	private showSearchBar()
	{
		this.parentTabBar = this.node.closest('.lm-DockPanel, .lm-TabPanel')?.querySelector(`.lm-TabBar:has(li.${this.id})`) as HTMLElement;

		if(this.parentTabBar && this.currentTerminalCtx && this.currentTerminalCtx.searchContainer)
		{
			this.parentTabBar.appendChild(this.currentTerminalCtx.searchContainer);
			this.currentTerminalCtx.searchContainer.style.display = 'flex';

			// Calculate initial width
			window.requestAnimationFrame(() =>
			{
				this.resizeSearchContainer();
			});

			// Listen for window resizing to keep the width updated
			window.removeEventListener('resize', this.resizeSearchContainer);
			window.addEventListener('resize', this.resizeSearchContainer);
			this.currentTerminalCtx.searchObserver?.observe(this.node);
		}
	}

	/**
	 * Triggered by Lumino lifecycle manager when the tab loses active focus or is moved.
	 */
	protected onAfterHide(msg: any): void
	{
		super.onAfterHide(msg);
		this.releaseSession();

		if(this.currentTerminalCtx && this.currentTerminalCtx.searchContainer)
		{
			if(this.currentTerminalCtx.searchContainer.parentNode)
			{
				this.currentTerminalCtx.searchContainer.parentNode.removeChild(this.currentTerminalCtx.searchContainer);
			}
			this.currentTerminalCtx.searchContainer.style.display = 'none';
			window.removeEventListener('resize', this.resizeSearchContainer);
			this.currentTerminalCtx.searchObserver?.unobserve(this.node);
		}
	}

	protected onAfterAttach(msg: any): void
	{
		if(this.isVisible)
		{
			this.claimAndRenderSession();
			this.createSearchElement();
			window.requestAnimationFrame(() =>
			{
				this.showSearchBar();
			});
		}
		super.onAfterAttach(msg);
	}

	protected onBeforeDetach(msg: any): void
	{
		this.releaseSession();
		if(this.currentTerminalCtx && this.currentTerminalCtx.searchContainer
			&& this.currentTerminalCtx.searchContainer.parentNode)
		{
			this.currentTerminalCtx.searchContainer.parentNode.removeChild(this.currentTerminalCtx.searchContainer);
		}
		this.currentTerminalCtx?.searchObserver?.disconnect();
		super.onBeforeDetach(msg);
	}

	protected onResize(msg: any): void
	{
		super.onResize(msg);
		if(this.currentTerminalCtx)
		{
			TerminalPoolManager.getInstance().fitTerminalLayout(this.currentTerminalCtx);
		}
	}


	/**
	 * Requests an available terminal session from the static pool and mounts its element.
	 */
	private claimAndRenderSession(): void
	{
		const manager = TerminalPoolManager.getInstance();
		const shouldInitAll = manager.count() === 0 && this.filterId === 'all';

		// Acquire a terminal context (reused primary or dedicated secondary/tertiary split)
		this.currentTerminalCtx = manager.acquireTerminal(this);

		// Attach terminal DOM structure to this Lumino widget node
		this.node.appendChild(this.currentTerminalCtx.container);

		this.syncTerminalState();

		// Recalculate dimensions for the newly attached node viewport
		manager.fitTerminalLayout(this.currentTerminalCtx);

		if(shouldInitAll)
		{
			TerminalWidget.initializeAllPanels();
		}
	}

	/**
	 * Releases current active terminal session claim back to the global pool.
	 */
	private releaseSession(): void
	{
		if(this.currentTerminalCtx)
		{
			TerminalPoolManager.getInstance().releaseTerminal(this);
			this.currentTerminalCtx = null;
		}
	}

	/**
	 * Clears out existing frame contexts and streams the matching log filter content.
	 */
	public syncTerminalState(): void
	{
		if(!this.currentTerminalCtx) return;

		const term = this.currentTerminalCtx.term;
		term.reset();

		// Reapply theme variables dynamically based on root computed style mutations
		this.syncThemeWithAce(term);

		// Pull systemic historical logs from global/window structures
		const sharedLogs = terminalSelf.terminalLog;
		if(!sharedLogs || !Array.isArray(sharedLogs)) return;

		if(this.filterId === 'soft')
		{
			term.options.scrollback = 0;
			//captureRenderToTerminalCorner(term);
			terminalSelf.terminalLoaded = true;
			return;
		}

		term.options.scrollback = LINES_TO_SCROLLBACK;

		const filteredBuffer = sharedLogs
			.filter((log: any) =>
			{
				//const text = log.text || log || '';
				if(this.filterId === 'all') return true;
				return log.source === this.filterId || log.source?.includes(this.filterId);
			})
			.map((log: any) => log.text || log || '')
			.join('');

		term.write(filteredBuffer);

		// Maintain active blink schedules cleanly
		term.focus();
		const core = (term as any)._core;
		if(core && core._cursorBlinkContext)
		{
			core._cursorBlinkContext.restartInterval();
		}

		terminalSelf.terminalLoaded = true;
	}


	/**
	 * Pulls CSS variables from the DOM tree directly to paint the active terminal surface.
	 */
	private syncThemeWithAce(term: Terminal): void
	{
		const style = getComputedStyle(document.body);
		const getAceVar = (name: string) => style.getPropertyValue(name).trim();

		const background = getAceVar('--ace-bg');
		const foreground = getAceVar('--ace-foreground');
		const gutter = getAceVar('--ace-gutter-bg');
		const pink = getAceVar('--ace-pink');
		const purple = getAceVar('--ace-purple');
		const blue = getAceVar('--ace-blue');
		const green = getAceVar('--ace-green');

		const parseToHex = (colorStr: string): string =>
		{
			if(!colorStr || typeof colorStr !== 'string') return colorStr;
			if(colorStr.startsWith('#')) return colorStr;
			const match = colorStr.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
			if(!match) return colorStr;
			const hexR = parseInt(match[1], 10).toString(16).padStart(2, '0');
			const hexG = parseInt(match[2], 10).toString(16).padStart(2, '0');
			const hexB = parseInt(match[3], 10).toString(16).padStart(2, '0');
			return `#${hexR}${hexG}${hexB}`;
		};

		const bgHex = parseToHex(background);
		const fgHex = parseToHex(foreground);

		term.options.theme = {
			background: bgHex,
			foreground: fgHex,
			cursor: fgHex,
			selectionForeground: '#DEADBE',
			selectionBackground: '#DEADBE',
			selectionInactiveBackground: '#DEADBE',
			black: bgHex,
			white: fgHex,
			magenta: parseToHex(pink),
			cyan: parseToHex(purple),
			blue: parseToHex(blue),
			green: parseToHex(green),
			brightBlack: parseToHex(gutter)
		};
	}


	static initializeAllPanels()
	{

		// Mount all widgets into the unified layout terminal area stack
		terminalSelf.TERMINAL_REGISTRY?.forEach((filter, index) =>
		{
			if(document.querySelector(`#terminal-panel-${filter.id}`))
			{
				return;
			}

			const widget = new TerminalWidget(filter.id, filter.label);

			if(index === 0)
			{
				terminalSelf.mainDock?.addWidget(widget);
			} else
			{
				const existingTerminals = Array.from(terminalSelf.mainDock?.widgets() ?? []); // incase the closed something
				const mainTerminal = existingTerminals.find(w => w.id === 'terminal-panel-all')
					?? existingTerminals.find(w => w.dataset.type === 'terminal');
				// Dock as tab items inside the same workspace panel grouping setup by default
				terminalSelf.mainDock?.addWidget(widget, { mode: 'tab-before', ref: mainTerminal });
			}
		});
	}
}

terminalSelf.TerminalWidget = TerminalWidget;


const LOCAL_SETTINGS: Record<string, Record<string, SettingConfig>> = {
	terminal: {
		commandHistory: {
			key: 'history',
			default: [],
			type: 'array',
			description: 'An indexed collection tracking sequential command strings typed into the text interface console for fast history scrolling.',
			set: (val) =>
			{
				const newValue = val.slice(0);
				if(!terminalSelf.commandHistory) terminalSelf.commandHistory = [];
				terminalSelf.commandHistory.length = 0;
				if(Array.isArray(newValue))
				{
					newValue.forEach(cmd => { if(cmd.trim()) terminalSelf.commandHistory?.push(cmd); });
				}
			}
		},
		terminalLog: {
			key: 'terminal_log',
			edit: false,
			default: [],
			type: 'json',
			description: 'Persistent text logging buffer retaining runtime system updates, build logs, and standard out/error print operations.'
		}
	},

};


if(!terminalSelf.IMPORT_SETTINGS)
{
	terminalSelf.IMPORT_SETTINGS = {};
}

for(const [moduleKey, configs] of Object.entries(LOCAL_SETTINGS))
{
	terminalSelf.IMPORT_SETTINGS[moduleKey] = {
		...(terminalSelf.IMPORT_SETTINGS[moduleKey] || {}),
		...configs
	};
}

export const IMPORT_SETTINGS = terminalSelf.IMPORT_SETTINGS;
