
// @ts-check

/* ======================================================================== */
/* ANTI-IFRAME-BREAKOUT HARDENING & LOCATION TRAPPING                      */
/* ======================================================================== */
(function preventFrameBreakout()
{
	const realWindow = window;

	// 1. Trap window.top and window.parent Location Access
	// Creates a fake Location object so `top.location = ...` or `top.location.href = ...` mutates a dummy target
	const dummyLocation = Object.create(Object.prototype, {
		href: {
			get: () => realWindow.location.href,
			set: (url) =>
			{
				console.warn('[AntiBreakout] Intercepted frame breakout attempt to:', url);
				// Route through your WebSocket proxy or internal navigation handler instead
				return url;
			},
			enumerable: true,
			configurable: false
		},
		replace: {
			/**
			 *
			 * @param {string} url
			 */
			value: function replace(url)
			{
				console.warn('[AntiBreakout] Intercepted location.replace breakout attempt to:', url);
			},
			writable: false,
			configurable: false
		},
		assign: {
			/**
			 *
			 * @param {string} url
			 */
			value: function assign(url)
			{
				console.warn('[AntiBreakout] Intercepted location.assign breakout attempt to:', url);
			},
			writable: false,
			configurable: false
		}
	});

	// Proxy Fake Top/Parent Objects
	const fakeTopWindow = new Proxy(realWindow, {
		get(target, prop)
		{
			if(prop === 'location') return dummyLocation;
			if(prop === 'top' || prop === 'parent' || prop === 'self') return fakeTopWindow;
			const value = Reflect.get(target, prop);
			return typeof value === 'function' ? value.bind(target) : value;
		},
		set(target, prop, value)
		{
			if(prop === 'location')
			{
				dummyLocation.href = value;
				return true;
			}
			return Reflect.set(target, prop, value);
		}
	});

	// Override window.top and window.parent getters
	try
	{
		Object.defineProperty(window, 'top', {
			get: () => fakeTopWindow,
			set: undefined,
			configurable: false,
			enumerable: true
		});
		Object.defineProperty(window, 'parent', {
			get: () => fakeTopWindow,
			set: undefined,
			configurable: false,
			enumerable: true
		});
	} catch(e) { }

	// 2. Neutralize target="_top" and target="_parent" Link Breakouts
	// Captures clicks on <a> or <form> elements attempting to target the top-level window
	window.addEventListener('click', (event) =>
	{
		const targetEl = event.target ? event.target.closest('a, form') : null;
		if(targetEl)
		{
			const targetAttr = targetEl.getAttribute('target');
			if(targetAttr === '_top' || targetAttr === '_parent')
			{
				event.preventDefault();
				event.stopPropagation();

				const destinationUrl = targetEl.href || targetEl.action;
				console.warn('[AntiBreakout] Intercepted target="_top" link click to:', destinationUrl);

				// Rewrite navigation internally inside the iframe
				if(targetEl.tagName.toLowerCase() === 'a' && destinationUrl)
				{
					window.location.href = destinationUrl;
				}
			}
		}
	}, true); // Capture phase execution
})();

(function ()
{
	'use strict';

	/* ======================================================================== */
	/* 1. IMMEDIATE SELF-CLOAKING & DOM ERASURE                                 */
	/* ======================================================================== */
	try
	{
		const currentScript = document.currentScript;
		if(currentScript && currentScript.parentNode)
		{
			currentScript.parentNode.removeChild(currentScript);
		}
	} catch(e)
	{
		// Silent fail if execution context restricts script node access
	}

	/* ======================================================================== */
	/* 2. NATIVE METHOD TOSTRING CLOAKING (ANTI-TAMPER PROTECTION)              */
	/* ======================================================================== */
	const NativeFunctionToString = Function.prototype.toString;
	const overriddenMethods = new WeakSet();

	/**
	 *
	 * @param {Function} fn
	 * @param {string} name
	 */
	function markAsNative(fn, name)
	{
		overriddenMethods.add(fn);
		Object.defineProperty(fn, 'name', { value: name, configurable: true });
	}

	Function.prototype.toString = function ()
	{
		if(overriddenMethods.has(this))
		{
			return `function ${this.name || ''}() { [native code] }`;
		}
		return NativeFunctionToString.call(this);
	};
	markAsNative(Function.prototype.toString, 'toString');

	/* ======================================================================== */
	/* 3. IFRAME & TOP-LEVEL WINDOW CLOAKING                                    */
	/* ======================================================================== */
	const realWindow = window;

	// Mask window.top, window.parent, window.self, and window.frameElement
	const windowProps = {
		top: { get: () => realWindow },
		parent: { get: () => realWindow },
		self: { get: () => realWindow },
		frameElement: { get: () => null }
	};

	for(const [prop, descriptor] of Object.entries(windowProps))
	{
		try
		{
			Object.defineProperty(window, prop, {
				get: descriptor.get,
				set: undefined,
				configurable: false,
				enumerable: true
			});
			markAsNative(descriptor.get, `get ${prop}`);
		} catch(e)
		{
			// Ignore if browser restricts re-defining global window property
		}
	}

	/* ======================================================================== */
	/* 4. ENVIRONMENT HARDENING (AUTOMATION & PERMISSION MASKS)                 */
	/* ======================================================================== */
	// Mask Navigator Automation Flags
	try
	{
		Object.defineProperty(navigator, 'webdriver', {
			get: () => undefined,
			configurable: true,
			enumerable: true
		});

		Object.defineProperty(navigator, 'languages', {
			get: () => ['en-US', 'en'],
			configurable: true,
			enumerable: true
		});
	} catch(e) { }

	// Mock chrome runtime object if missing
	if(!('chrome' in window))
	{
		const mockChrome = {
			app: { isInstalled: false, InstallState: { DISABLED: 'DISABLED', INSTALLED: 'INSTALLED', NOT_INSTALLED: 'NOT_INSTALLED' } },
			runtime: { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformNaclArch: {}, PlatformOs: {} }
		};
		Object.defineProperty(window, 'chrome', {
			value: mockChrome,
			writable: false,
			configurable: true,
			enumerable: true
		});
	}

	// Sanitize Permissions Query
	if(navigator.permissions && navigator.permissions.query)
	{
		const originalQuery = navigator.permissions.query;
		navigator.permissions.query = function (parameters)
		{
			if(parameters && parameters.name === 'notifications')
			{
				return Promise.resolve({ state: Notification.permission, onchange: null });
			}
			return originalQuery.apply(this, arguments);
		};
		markAsNative(navigator.permissions.query, 'query');
	}

	/* ======================================================================== */
	/* 4. ENVIRONMENT HARDENING & PROTOTYPE-LEVEL NAVIGATOR CLOAKING            */
	/* ======================================================================== */
	(function cloakNavigator()
	{
		const NavProto = Navigator.prototype;

		// Helper to safely redefine prototype getters with toString masking
		/**
		 *
		 * @param {Function} proto
		 * @param {string} prop
		 * @param {(() => any)} getterFn
		 */
		function redefineGetter(proto, prop, getterFn)
		{
			markAsNative(getterFn, `get ${prop}`);
			try
			{
				Object.defineProperty(proto, prop, {
					get: getterFn,
					set: undefined,
					enumerable: true,
					configurable: true
				});
			} catch(e) { }
		}

		// 1. Mask navigator.webdriver on Prototype level (returns undefined, no own-property leak)
		redefineGetter(NavProto, 'webdriver', function webdriver()
		{
			return undefined;
		});

		// 2. Mask navigator.languages
		redefineGetter(NavProto, 'languages', function languages()
		{
			return Object.freeze(['en-US', 'en']);
		});

		// 3. Mask navigator.getGamepads getter on Prototype
		redefineGetter(NavProto, 'getGamepads', getGamepadsMock);

		// 4. Mock navigator.plugins / mimeTypes to avoid empty array detection
		const mockPluginList = Object.create(PluginArray.prototype);
		Object.defineProperty(mockPluginList, 'length', { value: 3, enumerable: true });
		redefineGetter(NavProto, 'plugins', function plugins()
		{
			return mockPluginList;
		});

		// 5. Hardened Permissions Query
		if(navigator.permissions && navigator.permissions.query)
		{
			const origQuery = navigator.permissions.query;
			/**
			 * @this {Navigator}
			 * @param {any} parameters
			 * @returns
			 */
			const patchedQuery = function query(parameters)
			{
				if(parameters && parameters.name === 'notifications')
				{
					return Promise.resolve({ state: 'granted', onchange: null });
				}
				return origQuery.apply(this, arguments);
			};
			markAsNative(patchedQuery, 'query');
			NavProto.permissions.query = patchedQuery;
		}

		// 6. Mock Chrome Client Hints (navigator.userAgentData)
		if('userAgentData' in navigator)
		{
			const mockUaData = {
				brands: [
					{ brand: 'Chromium', version: '124' },
					{ brand: 'Google Chrome', version: '124' },
					{ brand: 'Not-A.Brand', version: '99' }
				],
				mobile: false,
				platform: 'Windows',
				getHighEntropyValues: function getHighEntropyValues()
				{
					return Promise.resolve({
						architecture: 'x86',
						bitness: '64',
						model: '',
						platformVersion: '10.0.0',
						fullVersionList: this.brands
					});
				}
			};
			markAsNative(mockUaData.getHighEntropyValues, 'getHighEntropyValues');
			redefineGetter(NavProto, 'userAgentData', function userAgentData()
			{
				return mockUaData;
			});
		}
	})();

	/* ======================================================================== */
	/* 5. VIRTUAL GAMEPAD BUS & EVENT TUNNELING (HOST/WORKER <-> IFRAME)       */
	/* ======================================================================== */
	const virtualGamepads = new Map();

	/**
	 *
	 * @param {string} id
	 * @param {number} index
	 * @returns
	 */
	function createMockGamepad(id, index)
	{
		return {
			id: id || 'Standard Wireless Controller (Virtual Handshake)',
			index: index,
			connected: true,
			timestamp: performance.now(),
			mapping: 'standard',
			axes: [0, 0, 0, 0],
			buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0.0 }))
		};
	}

	// Override navigator.getGamepads
	const getGamepadsMock = function ()
	{
		const list = [null, null, null, null];
		for(const [index, pad] of virtualGamepads.entries())
		{
			if(index >= 0 && index < 4)
			{
				pad.timestamp = performance.now();
				list[index] = pad;
			}
		}
		return list;
	};
	markAsNative(getGamepadsMock, 'getGamepads');

	try
	{
		Object.defineProperty(navigator, 'getGamepads', {
			value: getGamepadsMock,
			writable: true,
			configurable: true,
			enumerable: true
		});
	} catch(e)
	{
		navigator.getGamepads = getGamepadsMock;
	}

	/* ======================================================================== */
	/* 6. VIRTUAL INPUT BUS (POSTMESSAGE LISTENER)                             */
	/* ======================================================================== */
	window.addEventListener('message', (event) =>
	{
		const msg = event.data;
		if(!msg || typeof msg !== 'object') return;

		switch(msg.type)
		{
			/* --- VIRTUAL GAMEPAD INPUT (Rebound from Host/Worker UI) --- */
			case 'VIRTUAL_GAMEPAD_INPUT': {
				const { index = 0, id, buttons, axes } = msg.payload;
				if(!virtualGamepads.has(index))
				{
					virtualGamepads.set(index, createMockGamepad(id, index));

					// Dispatch gamepadconnected event inside iframe context
					const connectEvent = new Event('gamepadconnected');
					Object.defineProperty(connectEvent, 'gamepad', { value: virtualGamepads.get(index) });
					window.dispatchEvent(connectEvent);
				}

				const gamepad = virtualGamepads.get(index);

				// Update Rebound Buttons
				if(Array.isArray(buttons))
				{
					buttons.forEach((btn, btnIdx) =>
					{
						if(gamepad.buttons[btnIdx])
						{
							gamepad.buttons[btnIdx].pressed = Boolean(btn.pressed);
							gamepad.buttons[btnIdx].touched = Boolean(btn.touched);
							gamepad.buttons[btnIdx].value = typeof btn.value === 'number' ? btn.value : (btn.pressed ? 1.0 : 0.0);
						}
					});
				}

				// Update Rebound Axes
				if(Array.isArray(axes))
				{
					axes.forEach((axisValue, axisIdx) =>
					{
						if(gamepad.axes[axisIdx] !== undefined)
						{
							gamepad.axes[axisIdx] = axisValue;
						}
					});
				}
				break;
			}

			/* --- VIRTUAL KEYBOARD DISPATCHER --- */
			case 'VIRTUAL_KEYBOARD_EVENT': {
				const { eventType, key, code, keyCode, altKey, ctrlKey, shiftKey, metaKey } = msg.payload;
				const targetEl = document.activeElement || document.body || window;
				const keyEvent = new KeyboardEvent(eventType || 'keydown', {
					key: key,
					code: code,
					keyCode: keyCode,
					which: keyCode,
					altKey: altKey || false,
					ctrlKey: ctrlKey || false,
					shiftKey: shiftKey || false,
					metaKey: metaKey || false,
					bubbles: true,
					cancelable: true
				});
				targetEl.dispatchEvent(keyEvent);
				break;
			}

			/* --- VIRTUAL MOUSE DISPATCHER --- */
			case 'VIRTUAL_MOUSE_EVENT': {
				const { eventType, clientX, clientY, button, buttons } = msg.payload;
				const targetEl = document.elementFromPoint(clientX, clientY) || document.body || window;
				const mouseEvent = new MouseEvent(eventType || 'mousemove', {
					clientX: clientX,
					clientY: clientY,
					button: button || 0,
					buttons: buttons || 0,
					bubbles: true,
					cancelable: true
				});
				targetEl.dispatchEvent(mouseEvent);
				break;
			}
		}
	});

})();
