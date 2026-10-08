import './logging';
import './levenshtein';
import './lumino-search';
import './github-worker';
import { BoxPanel, DockPanel, Widget, Menu, MenuBar } from '@lumino/widgets';
import * as commands from '@lumino/commands';
import * as widgets from '@lumino/widgets';
import * as messaging from '@lumino/messaging';
import * as datagrid from '@lumino/datagrid';
import * as signaling from '@lumino/signaling';
import { createTopBar, initializeMenus, MODULE_REGISTRY, renderHashCommand, TERMINAL_REGISTRY, TOOLS_REGISTRY, triggerPanelRoute } from './menu';
import { StatusBarWidget } from './status';
import { ServiceWorkerManager } from './worker';
import { SettingConfig, SettingsManager } from './settings';
import { isDevToolsOpen, OUTLINE_WIDGET_TYPES, ResponsiveManager } from './lumino-resize';

import '@lumino/widgets/style/index.css';
//import '@lumino/default-theme/style/index.css'
import { applyInitialLayout } from './menu-layout';
import JSZip from 'jszip';
import type { LuminoLayoutWindow } from './lumino.d';
import type { LuminoMenuWindow, RepositorySettingsWindow } from './menu.d';
import { updateHashFromWidget } from './lumino-widget';
import { SplashScreenWidget } from './splash';


const luminoSelf: LuminoLayoutWindow & LuminoMenuWindow & RepositorySettingsWindow = self as unknown as any;


luminoSelf.Lumino = {
	widgets,
	messaging,
	commands,
	datagrid,
	signaling
};
luminoSelf.JSZip = JSZip;



console.log("Lumino Core injected into global window space.");

function main(): void
{
	// Initialize the Command Registry
	const commandRegistry = new commands.CommandRegistry();
	// TODO: interesting, i actually meant to do this in the previous version
	//   and now Gemini and Lumino combined forced me to set it up anyways.
	luminoSelf.commandRegistry = commandRegistry;

	// Create the central DockPanel target area
	const mainDock = new DockPanel({
		mode: 'multiple-document'
	});
	mainDock.id = 'main-workspace';
	luminoSelf.mainDock = mainDock;

	// Generate the top application header structures using our unified layout export
	const { headerRow, menuBar } = createTopBar(commandRegistry);

	// Build a manual sidebar widget for the left boundary (VSCode style)
	const toolbar = new Widget();
	toolbar.id = 'left-toolbar';
	luminoSelf.toolbarWidget = toolbar;
	toolbar.node.style.minWidth = '50px';

	// Initialize remaining menus safely passing down the clean tracking components
	initializeMenus(commandRegistry, menuBar, mainDock, toolbar.node);

	const statusBar = new StatusBarWidget();
	luminoSelf.statusBar = statusBar;
	const envStatusNode = statusBar.addStatusItem('env-state', 'Initializing Sync...', 'bx bx-sync bx-spin', 'left');
	statusBar.addStatusItem('git-branch', 'main', 'bx bx-git-branch', 'right');
	luminoSelf.envStatusNode = envStatusNode;

	// Construct the global parent layout anchor structure
	const workspaceBox = new BoxPanel({ direction: 'left-to-right', spacing: 0 });
	workspaceBox.id = 'workspace-box';
	BoxPanel.setStretch(toolbar, 0);
	BoxPanel.setStretch(mainDock, 1);
	workspaceBox.addWidget(toolbar);
	workspaceBox.addWidget(mainDock);

	// Assemble Main Window layout
	const windowRoot = new BoxPanel({ direction: 'top-to-bottom', spacing: 0 });
	windowRoot.id = 'app-root';
	BoxPanel.setStretch(headerRow, 0);
	BoxPanel.setStretch(workspaceBox, 1);
	BoxPanel.setStretch(statusBar, 0);

	windowRoot.addWidget(headerRow);
	windowRoot.addWidget(workspaceBox);
	windowRoot.addWidget(statusBar);

	// Attach directly to the viewport boundary frame
	Widget.attach(windowRoot, document.body);
	windowRoot.fit();

	mainDock.layoutModified.connect(() =>
	{
		const remainingWidgets = Array.from(mainDock.widgets());
		console.log('Dock layout updated. Remaining widget count:', remainingWidgets.length);
		luminoSelf.resizeHandler?.();
	});


	messaging.MessageLoop.installMessageHook(mainDock, (handler, msg: messaging.Message) =>
	{
		//console.log(msg);
		if(msg.type === 'child-shown' && (msg as any).child)
		{
			const shownWidget = (msg as any).child as Widget;
			const newType = shownWidget?.constructor.name;
			const lastType = luminoSelf.lastInteractedWidget?.constructor.name;

			if(newType !== lastType || shownWidget !== luminoSelf.lastInteractedWidget)
			{
				luminoSelf.previousInteractedWidget = luminoSelf.lastInteractedWidget;
				luminoSelf.lastInteractedWidget = shownWidget;

				updateHashFromWidget(shownWidget);
			}

			console.log('Active: ' + luminoSelf.lastInteractedWidget?.constructor.name + ' inActive: ' + luminoSelf.previousInteractedWidget?.constructor.name);
			requestAnimationFrame(() =>
			{
				luminoSelf.resizeHandler?.();
			});
		}


		if(msg.type === 'child-added' && (msg as any).child)
		{
			const addingWidget = (msg as any).child as Widget;
			const newType = addingWidget?.constructor.name;
			const lastType = luminoSelf.lastInteractedWidget?.constructor.name;

			// Only update history if the incoming widget type is different from the last tracked type
			if(newType !== lastType)
			{
				luminoSelf.previousInteractedWidget = luminoSelf.lastInteractedWidget;
				luminoSelf.lastInteractedWidget = addingWidget;
			}

			console.log('Added widget: ' + luminoSelf.lastInteractedWidget?.constructor.name + ' inActive: ' + luminoSelf.previousInteractedWidget?.constructor.name);
			requestAnimationFrame(() =>
			{
				luminoSelf.resizeHandler?.();
			});
		}


		if(msg.type === 'child-removed' && (msg as any).child)
		{
			// The handler in this context is the widget receiving the close command
			const closingWidget = (msg as any).child as Widget;
			console.log(`Intercepted close event for: ${closingWidget.id}`);

			// 2. Determine your fallback activation target
			let fallbackWidget: Widget | null = null;

			// Strategy A: Fallback to the last tracked active widget if it's still alive and not the closing one
			if(luminoSelf.previousInteractedWidget && luminoSelf.previousInteractedWidget !== closingWidget
				&& luminoSelf.previousInteractedWidget.parent && !luminoSelf.previousInteractedWidget.isDisposed)
			{
				fallbackWidget = luminoSelf.previousInteractedWidget;
			} else
			{
				// Strategy B: Pull remaining widgets and find the first non-filelist editor
				const remaining = Array.from(mainDock.widgets()).filter(w => w !== closingWidget && !w.isHidden);
				fallbackWidget = remaining.find(w => !OUTLINE_WIDGET_TYPES.includes(w.constructor.name)) ?? remaining[0] ?? null;
			}

			// 3. Queue the activation right after the layout pass finishes processing the removal
			if(fallbackWidget)
			{
				const target = fallbackWidget;
				setTimeout(() =>
				{
					if(!target.isDisposed && !target.isHidden && target.isAttached)
					{
						luminoSelf.lastInteractedWidget = target;
						mainDock.activateWidget(target);
						luminoSelf.resizeHandler?.();
					}
				}, 100);
			}
		}

		return true;
	});

	const resizeHandler = () =>
	{
		ResponsiveManager.getInstance().handleResize(windowRoot, workspaceBox, headerRow, menuBar, toolbar, mainDock);
	};
	setTimeout(resizeHandler, 100);
	luminoSelf.resizeHandler = resizeHandler;
	window.addEventListener('resize', resizeHandler);

	SettingsManager.hydrateAll();

	isDevToolsOpen();

	const splash = new SplashScreenWidget('Starting Up...');
	luminoSelf.splashScreen = splash;
	Widget.attach(splash, document.body);

	startServiceWorker().then(async () =>
	{
		// because scripts depend on service worker injections and TODO: eventually compiling from SW
		const activeHash = window.location.hash.substring(1);
		await renderHashCommand(activeHash, true);

		// TODO: load default editor specified in localStorage
		const userWorkspaceChoice = SettingsManager.get('core', 'workspaceDefault');
		if(Array.from(mainDock.widgets()).length === 0
			&& (MODULE_REGISTRY[userWorkspaceChoice]
				|| TOOLS_REGISTRY[userWorkspaceChoice])
		)
		{
			await triggerPanelRoute(userWorkspaceChoice, mainDock, true);
		}
		await luminoSelf.splashScreen?.dismiss();
	});

}

async function startServiceWorker()
{
	const swManager = new ServiceWorkerManager();

	let workerState = luminoSelf.statusBar?.addStatusItem('sw-state', '[SW] Loading', 'bx bx-radio-circle', 'right');

	try
	{
		await swManager.initialize();
		// Update status to 'Worker Ready' and swap spin icon to a solid verified check shield
		luminoSelf.statusBar?.updateStatusItem('env-state', 'Worker Ready');
		luminoSelf.statusBar?.updateStatusItem('sw-state', '[SW] Active');
		const iconNode = luminoSelf.envStatusNode?.querySelector('i');
		if(iconNode)
		{
			iconNode.className = 'bx bx-check-shield';
		}
		const stateNode = workerState?.querySelector('i');
		if(stateNode)
		{
			stateNode.className = 'bx bx-circle-marked';
		}

		setTimeout(() =>
		{
			luminoSelf.statusBar?.updateStatusItem('env-state', '');
			if(iconNode)
			{
				iconNode.className = ''; // Remove the icon asset footprint too
			}
		}, 8000);
	} catch(err)
	{
		console.error("Critical worker boot fault:", err);
		luminoSelf.statusBar?.updateStatusItem('env-state', 'Sync Error');
		luminoSelf.statusBar?.updateStatusItem('sw-state', '[SW] Error');
		const iconNode = luminoSelf.envStatusNode?.querySelector('i');
		if(iconNode)
		{
			iconNode.className = 'bx bx-error-circle';
		}
		const stateNode = workerState?.querySelector('i');
		if(stateNode)
		{
			stateNode.className = 'bx bx-error-circle';
		}
	}


}


function setTheme(theme: string)
{
	const themeName = theme.split('/').pop(); // Gets 'monokai' or 'dracula'

	if(!themeName)
	{
		return;
	}

	for(let cn of document.body.classList)
	{
		if(cn.startsWith('theme-'))
		{
			document.body.classList.remove(cn);
		}
	}

	document.body.classList.add(`theme-${themeName.replace(/_/g, '-')}`);
}




const LOCAL_SETTINGS: Record<string, Record<string, SettingConfig>> = {
	core: {
		workspaceDefault: {
			key: 'workspace_default',
			default: 'fileview',
			description: 'Specifies the default active panel or system layout view presented to users upon launching the application interface.'
		},
		environmentVersion: {
			key: 'environment_version',
			default: new Date(0),
			description: 'The last commit date for the environment repository set automatically.',
		},
		savedTheme: {
			key: 'theme',
			default: 'ace/theme/monokai',
			elementId: 'theme',
			description: 'The visual theme layout package used to style the interactive Ace code editor window background and syntax colors.',
			set: setTheme
		},
		layoutState: {
			key: 'layout',
			type: 'json',
			default: '{"panels":"left-hand-files","order":"normal-order","terminal":"terminal","mode":"full-mode"}',
			description: 'The layout order for opening new panels and resizing the window, snaps back to this state when the environment changes.',
			set: applyInitialLayout
		},
		layoutConfiguration: {
			key: 'layout_config',
			type: 'json',
			default: null,
			description: 'Lumino layout configuration according to how tabs are arranged.'
		},
		currentConfig: {
			key: 'configuration',
			default: 'client',
			elementId: 'configuration',
			description: 'Determines the target compilation profile rules, distinguishing targets such as full client builds or dedicated server binaries.'
		},
		hotReload: {
			key: 'hot_reload',
			default: true,
			elementId: 'reload',
			type: 'boolean',
			description: 'When true, enables immediate compilation triggers and injection changes directly into the live executable WASM state upon saving files.'
		}

	}
};

if(!luminoSelf.IMPORT_SETTINGS)
{
	luminoSelf.IMPORT_SETTINGS = {};
}

for(const [moduleKey, configs] of Object.entries(LOCAL_SETTINGS))
{
	luminoSelf.IMPORT_SETTINGS[moduleKey] = {
		...(luminoSelf.IMPORT_SETTINGS[moduleKey] || {}),
		...configs
	};
}

// 4. Export the unified reference for standard module compilation tracking
export const IMPORT_SETTINGS = luminoSelf.IMPORT_SETTINGS;

document.addEventListener('DOMContentLoaded', main);
