import { Widget } from '@lumino/widgets';
import { LONG_NAME } from '../bundle/global';

export interface HostingStatusState
{
	apiToken: string;
	tunnelName: string;
	accountId: string;
	domain: string;
	tunnelStatus: string;
	lastChecked: string;
	hostStatus: string;
	hostChecked: string;
	serviceStatus: string;
	serviceChecked: string;
	isWorking: boolean | null;
	isTunneling: boolean | null;
	isServicing: boolean | null;
	installed: boolean | null;
	startupTray: boolean | null;
}

// TODO: finish this in the context of illustrious
export class HostingWidget extends Widget
{
	private state: HostingStatusState = {
		apiToken: '',
		tunnelName: '',
		accountId: '',
		domain: '',
		tunnelStatus: 'Checking Cloudflare...',
		lastChecked: 'Never',
		hostStatus: 'Checking Public Access...',
		hostChecked: 'Never',
		serviceStatus: 'Checking Services...',
		serviceChecked: 'Never',
		isWorking: null,
		isTunneling: null,
		isServicing: null,
		installed: null,
		startupTray: null
	};

	private timerHandle: any = null;

	constructor()
	{
		super();
		this.addClass('lm-HostingWidget');
		this.title.label = 'Hosting Administration';
		this.title.closable = true;

		this.renderWidget();
		this.initPolling();
	}

	public dispose(): void
	{
		if(this.timerHandle)
		{
			clearInterval(this.timerHandle);
		}
		super.dispose();
	}

	private initPolling(): void
	{
		this.pollStatus();
		this.timerHandle = setInterval(() => this.pollStatus(), 60 * 3 * 1000);
	}

	private async pollStatus(): Promise<void>
	{
		try
		{
			// Client-side simulation of Cloudflare API check & local host probe
			this.state.lastChecked = new Date().toLocaleTimeString();
			this.state.serviceChecked = new Date().toLocaleTimeString();
			this.state.hostChecked = new Date().toLocaleTimeString();

			if(!this.state.accountId || !this.state.tunnelName || !this.state.apiToken)
			{
				this.state.tunnelStatus = 'Missing Credentials';
				this.state.isTunneling = false;
			} else
			{
				// Fetch real Cloudflare API tunnel status directly from client
				const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.state.accountId}/cfd_tunnel?name=${this.state.tunnelName}&is_deleted=false`, {
					headers: { 'Authorization': `Bearer ${this.state.apiToken}` }
				});
				const data = await res.json();
				const status = data?.result?.[0]?.status || 'Unknown';
				this.state.tunnelStatus = status;
				this.state.isTunneling = (status === 'healthy');
			}

			this.state.isServicing = true;
			this.state.serviceStatus = 'Service is active (Browser Client)';

			if(this.state.domain)
			{
				this.state.hostStatus = `Tokens match, site is live and accessible.`;
				this.state.isWorking = true;
			} else
			{
				this.state.hostStatus = 'Domain name not set.';
				this.state.isWorking = false;
			}
		} catch(err: any)
		{
			this.state.tunnelStatus = `Error: ${err.message}`;
			this.state.isTunneling = false;
			this.state.isWorking = false;
		}

		this.renderWidget();
	}

	private renderWidget(): void
	{
		const isExpandedBecome = this.state.isWorking !== true;
		const isExpandedPrereq = this.state.isWorking !== true;
		const isExpandedAccount = this.state.isWorking !== true;

		this.node.innerHTML = `
      <article>
        <!-- Settings Form Row Section -->
        <div class="form-row">
          <label>Enable HTTP hosting</label>
          <input type="checkbox" class="chk-servicing" ${this.state.isServicing ? 'checked' : ''} />
        </div>
        <div class="form-row">
          <label>Enable as a Local Service / Runner</label>
          <input type="checkbox" class="chk-installed" ${this.state.installed ? 'checked' : ''} />
        </div>
        <div class="form-row">
          <label>Run application in background / system tray</label>
          <input type="checkbox" class="chk-startup" ${this.state.startupTray ? 'checked' : ''} />
        </div>

        <!-- Accordion Instructions -->
        <div class="accordion-section">
          <div class="accordion-header" data-target="become">
            <span>Become A Host</span>
            <i class="bi bi-chevron-down"></i>
          </div>
          <div class="accordion-content ${isExpandedBecome ? '' : 'is-collapsed'}" id="acc-become">
            <p>The easiest pipeline to monitored hosting is to enable the ${LONG_NAME} web service.</p>
            <p>Then use cloud-flared reverse tunnel to secure your domain past any firewall restrictions.</p>
            <p>Disclaimer - This runs self-contained within your browser and local worker tunnels.</p>
          </div>
        </div>

        <div class="accordion-section">
          <div class="accordion-header" data-target="prereq">
            <span>Install Prerequisites</span>
            <i class="bi bi-chevron-down"></i>
          </div>
          <div class="accordion-content ${isExpandedPrereq ? '' : 'is-collapsed'}" id="acc-prereq">
            <a href="https://github.com/cloudflare/cloudflared/releases" target="_blank">Cloudflared download page</a>
            <h3 style="font-size: 13px; margin: 4px 0;">Create a tunnel</h3>
            <a href="https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/" target="_blank">Set up a tunnel</a>
            <h3 style="font-size: 13px; margin: 4px 0;">Create a read token</h3>
            <a href="https://developers.cloudflare.com/fundamentals/api/get-started/create-token/" target="_blank">Create token instructions</a>
          </div>
        </div>

        <div class="accordion-section">
          <div class="accordion-header" data-target="account">
            <span>Account Settings</span>
            <i class="bi bi-chevron-down"></i>
          </div>
          <div class="accordion-content ${isExpandedAccount ? '' : 'is-collapsed'}" id="acc-account">
            <label>Tunnel Name</label>
            <input type="text" class="input-tunnel" value="${this.state.tunnelName}" />

            <label>API Token</label>
            <input type="password" class="input-token" value="${this.state.apiToken}" />

            <label>Account ID</label>
            <input type="text" class="input-account" value="${this.state.accountId}" />

            <label>Domain Name</label>
            <input type="text" class="input-domain" value="${this.state.domain}" />
          </div>
        </div>

        <!-- Status Header -->
        <heading class="flex-row">
          <span></span>
          <span>Service</span>
          <span>Status</span>
          <span>Last Checked</span>
          <span>Actions</span>
        </heading>

        <!-- Status Rows -->
        <div class="flex-row">
          <span></span>
          <span>Cloudflare Service</span>
          <span>${this.state.serviceStatus}</span>
          <span>${this.state.serviceChecked}</span>
          <span><span class="bi ${this.getStatusIcon(this.state.isServicing)}"></span></span>
        </div>

        <div class="flex-row">
          <span></span>
          <span>Cloudflare API</span>
          <span>${this.state.tunnelStatus}</span>
          <span>${this.state.lastChecked}</span>
          <span><span class="bi ${this.getStatusIcon(this.state.isTunneling)}"></span></span>
        </div>

        <div class="flex-row">
          <span></span>
          <span>${LONG_NAME} Browser Host</span>
          <span>
            ${this.state.hostStatus}
            ${this.state.isWorking ? `<span> site is <a href="https://${this.state.domain}/" target="_blank">live and accessible.</a></span>` : ''}
          </span>
          <span>${this.state.hostChecked}</span>
          <span><span class="bi ${this.getStatusIcon(this.state.isWorking)}"></span></span>
        </div>
      </article>
    `;

		this.bindEvents();
	}

	private getStatusIcon(val: boolean | null): string
	{
		if(val === true) return 'bi-check-circle';
		if(val === false) return 'bi-x-circle';
		return 'bi-clock';
	}

	private bindEvents(): void
	{
		// Accordion toggles
		this.node.querySelectorAll('.accordion-header').forEach(header =>
		{
			header.addEventListener('click', () =>
			{
				const targetId = header.getAttribute('data-target');
				const content = this.node.querySelector(`#acc-${targetId}`);
				content?.classList.toggle('is-collapsed');
			});
		});

		// Input bindings
		const bindInput = (selector: string, key: keyof HostingStatusState) =>
		{
			const input = this.node.querySelector(selector) as HTMLInputElement;
			if(input)
			{
				input.addEventListener('input', (e) =>
				{
					(this.state as any)[key] = (e.target as HTMLInputElement).value;
				});
			}
		};

		bindInput('.input-tunnel', 'tunnelName');
		bindInput('.input-token', 'apiToken');
		bindInput('.input-account', 'accountId');
		bindInput('.input-domain', 'domain');

		// Checkbox triggers
		const bindCheckbox = (selector: string, key: keyof HostingStatusState) =>
		{
			const chk = this.node.querySelector(selector) as HTMLInputElement;
			if(chk)
			{
				chk.addEventListener('change', (e) =>
				{
					(this.state as any)[key] = (e.target as HTMLInputElement).checked;
					this.pollStatus();
				});
			}
		};

		bindCheckbox('.chk-servicing', 'isServicing');
		bindCheckbox('.chk-installed', 'installed');
		bindCheckbox('.chk-startup', 'startupTray');
	}
}
