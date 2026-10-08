// ts-check

import * as HappyDOMModule from 'happy-dom-without-node';
import type * as html2canvasType from "html2canvas";
//import * as jspdf from 'jspdf';


const sweetEmptyPage = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Tab</title>
    <style>
        :root {
            --bg-color: #0d1117;
            --card-bg: #161b22;
            --accent-color: #58a6ff;
            --text-main: #c9d1d9;
            --text-muted: #8b949e;
            --border-color: #30363d;
            --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            background-color: var(--bg-color);
            color: var(--text-main);
            font-family: var(--font-family);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
        }

        /* Clock & Date Header */
        .header {
            text-align: center;
            margin-bottom: 40px;
        }

        #clock {
            font-size: 4rem;
            font-weight: 300;
            letter-spacing: -1px;
            color: #ffffff;
            margin-bottom: 5px;
        }

        #date {
            font-size: 1rem;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 2px;
        }

        /* Combined Search Bar */
        .search-container {
            width: 100%;
            max-width: 600px;
            margin-bottom: 50px;
        }

        .search-form {
            display: flex;
            position: relative;
        }

        .search-input {
            width: 100%;
            padding: 16px 24px;
            font-size: 1.1rem;
            background-color: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 30px;
            color: #ffffff;
            outline: none;
            transition: all 0.2s ease-in-out;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .search-input:focus {
            border-color: var(--accent-color);
            box-shadow: 0 4px 20px rgba(88, 166, 255, 0.15);
        }

        /* Dashboard Grid Layout */
        .dashboard {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 24px;
            width: 100%;
            max-width: 900px;
        }

        @media (max-width: 768px) {
            .dashboard {
                grid-template-columns: 1fr;
            }
        }

        .category-card {
            background-color: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
        }

        .category-title {
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--accent-color);
            text-transform: uppercase;
            letter-spacing: 1.5px;
            margin-bottom: 16px;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 8px;
        }

        .links-list {
            list-style: none;
        }

        .links-list li {
            margin-bottom: 12px;
        }

        .links-list a {
            color: var(--text-main);
            text-decoration: none;
            font-size: 1rem;
            display: inline-block;
            transition: color 0.15s ease;
        }

        .links-list a:hover {
            color: #ffffff;
            transform: translateX(2px);
        }
    </style>
</head>
<body>

    <!-- Header Section -->
    <div class="header">
        <div id="clock">00:00</div>
        <div id="date">Loading Date...</div>
    </div>

    <!-- Search Section -->
    <div class="search-container">
        <form class="search-form" id="searchForm" action="https://google.com" method="get">
            <input type="text" name="q" class="search-input" id="searchInput" placeholder="Search Google or type a URL..." autofocus autocomplete="off">
        </form>
    </div>

    <!-- Quick Links Grid -->
    <div class="dashboard">
        <!-- Category 1: Essentials -->
        <div class="category-card">
            <h2 class="category-title">Daily Essentials</h2>
            <ul class="links-list">
                <li><a href="https://gmail.com">Gmail</a></li>
                <li><a href="https://google.com">Google Calendar</a></li>
                <li><a href="https://github.com">GitHub</a></li>
                <li><a href="https://notion.so">Notion</a></li>
            </ul>
        </div>

        <!-- Category 2: Media -->
        <div class="category-card">
            <h2 class="category-title">Entertainment</h2>
            <ul class="links-list">
                <li><a href="https://youtube.com">YouTube</a></li>
                <li><a href="https://netflix.com">Netflix</a></li>
                <li><a href="https://reddit.com">Reddit</a></li>
                <li><a href="https://spotify.com">Spotify</a></li>
            </ul>
        </div>

        <!-- Category 3: Productivity -->
        <div class="category-card">
            <h2 class="category-title">Development & Tools</h2>
            <ul class="links-list">
                <li><a href="https://chatgpt.com">ChatGPT</a></li>
                <li><a href="https://stackoverflow.com">Stack Overflow</a></li>
                <li><a href="https://figma.com">Figma</a></li>
                <li><a href="https://canva.com">Canva</a></li>
            </ul>
        </div>
    </div>

    <script>
        // Real-time Clock & Date Function
        function updateTime() {
            const now = new Date();

            // Format Time
            let hours = now.getHours();
            let minutes = now.getMinutes();
            hours = hours < 10 ? '0' + hours : hours;
            minutes = minutes < 10 ? '0' + minutes : minutes;
            document.getElementById('clock').textContent = \`\${hours}:\${minutes}\`;

            // Format Date
            const options = { weekday: 'long', month: 'short', day: 'numeric' };
            document.getElementById('date').textContent = now.toLocaleDateString('en-US', options);
        }
        setInterval(updateTime, 1000);
        updateTime();

        // Smart Search Bar Logic (Differentiates between a URL and a Google Search query)
        document.getElementById('searchForm').addEventListener('submit', function(e) {
            const input = document.getElementById('searchInput').value.trim();

            // Regular expression matching common domain structures
            const urlPattern = /^(https?:\/\/)?([\w\d-]+\.)+[\w-]+(\/[\w\d-./?%&=]*)?\$/i;

            if (urlPattern.test(input)) {
                e.preventDefault(); // Prevent standard Google form submission
                let targetUrl = input;
                if (!/^https?:\/\//i.test(targetUrl)) {
                    targetUrl = 'https://' + targetUrl; // Force secure prefix if missing
                }
                window.location.href = targetUrl;
            }
        });
    </script>
</body>
</html>
`;


const workerSelf: {
	cloneToDocument(): void;
	document: any;
	window: any;
	activeWindow: HappyDOMModule.Window;
	activeDocument: HappyDOMModule.Document;
	activeEngine: string;
	initialized: boolean;
	html2canvas: typeof html2canvasType;
	//jspdf: typeof jspdf;
	HappyDOM: typeof HappyDOMModule;
	Window: typeof HappyDOMModule.Window;
	GlobalWindow: typeof HappyDOMModule.GlobalWindow;
} = self as unknown as any;

// Explicitly register on Worker global scope
if(typeof self !== 'undefined')
{
	workerSelf.HappyDOM = HappyDOMModule;
	workerSelf.Window = HappyDOMModule.Window;
	workerSelf.GlobalWindow = HappyDOMModule.GlobalWindow;
	const happyWindow = new /** @type {new(opt: any) => import('happy-dom').Window} */(workerSelf.Window)({
		url: 'about:blank',
		settings: {
			disableJavaScriptEvaluation: false,
			disableCSSFileLoading: true
		}
	});

	workerSelf.activeWindow = happyWindow;
	workerSelf.activeDocument = happyWindow.document;
	cloneToDocument();

	if(workerSelf.activeDocument)
	{
		workerSelf.activeDocument.write(sweetEmptyPage);
	}

	workerSelf.activeEngine = 'happy-dom';
	workerSelf.initialized = true;
	const html2canvas = await import("html2canvas");
	workerSelf.html2canvas = html2canvas;
	//workerSelf.jspdf = jspdf;
}

function cloneToDocument()
{
	if(workerSelf.activeDocument)
	{
		// 1. Point workerSelf globals to JSDOM window & document globals
		//workerSelf.window = activeWindow;
		workerSelf.document = workerSelf.activeDocument;

		// 2. Bind DOM method context so calling document.createElement() works properly
		// Create a Proxy if workerSelf.document was already declared
		workerSelf.document = new Proxy(workerSelf.activeDocument, {
			get(target, prop, receiver)
			{
				const value = Reflect.get(target, prop, target);
				if(typeof value === 'function')
				{
					return value.bind(target); // Bind 'this' to activeDocument
				}
				return value;
			}
		});

		safelyExposeAllGlobals(workerSelf, workerSelf.activeWindow);

	}
}

workerSelf.cloneToDocument = cloneToDocument;

function safelyExposeAllGlobals(workerSelf: any, activeWindow: any)
{
	if(!activeWindow) return;

	let currentObj = activeWindow;
	const seenProperties = new Set();

	// 1. Walk up the entire prototype chain of the activeWindow
	while(currentObj && currentObj !== Object.prototype)
	{
		const props = Object.getOwnPropertyNames(currentObj);

		for(const prop of props)
		{
			// Skip if we've already processed this property from a lower prototype layer
			if(seenProperties.has(prop)) continue;
			seenProperties.add(prop);

			// 2. CRITICAL SAFETY CHECK: Never overwrite properties that already exist on workerSelf
			if(prop in workerSelf)
			{
				continue;
			}

			try
			{
				// 3. Fetch the original property descriptor from the specific prototype layer
				const descriptor = Object.getOwnPropertyDescriptor(currentObj, prop);
				if(!descriptor) continue;

				// 4. Handle standard values/functions and fix context binding
				if(descriptor.value !== undefined)
				{
					const value = descriptor.value;
					if(typeof value === 'function')
					{
						// Bind to activeWindow so inherited methods don't throw "Illegal Invocation"
						descriptor.value = value.bind(activeWindow);
					}
				} else
				{
					// Handle inherited getters/setters so they execute in the activeWindow context
					if(typeof descriptor.get === 'function')
					{
						const originalGet = descriptor.get;
						descriptor.get = function () { return originalGet.call(activeWindow); };
					}
					if(typeof descriptor.set === 'function')
					{
						const originalSet = descriptor.set;
						descriptor.set = function (val) { return originalSet.call(activeWindow, val); };
					}
				}

				// 5. Define it onto the worker's global scope
				Object.defineProperty(workerSelf, prop, descriptor);

			} catch(e)
			{
				// Fail silently for sealed/locked browser internal properties
				console.warn(`Could not mirror inherited property "${prop}":`, e);
			}
		}

		// Move up to the next prototype level
		currentObj = Object.getPrototypeOf(currentObj);
	}

	// 6. Circular self-reference fallback
	if(!('window' in workerSelf))
	{
		workerSelf.window = workerSelf;
	}
}

export default HappyDOMModule;
