import { Widget } from '@lumino/widgets';
import type { ISignal } from '@lumino/signaling';

export interface DownloadItem
{
	id: string;
	filename: string;
	transferredBytes: number;
	totalBytes: number;
	speed?: string; // e.g. "2.4 MB/s"
	status: 'active' | 'complete' | 'failed';
	timestamp: string;
}

export interface IDownloadOptions
{
	items?: DownloadItem[];
	added?: ISignal<Widget, DownloadItem[]>;
}

export class DownloadWidget extends Widget
{
	private activeListContainer: HTMLUListElement;
	private historyListContainer: HTMLUListElement;
	private items: Map<string, DownloadItem> = new Map();
	private subscribed?: ISignal<Widget, DownloadItem[]>;
	private subAdded?: (_: any, list: any) => void;

	constructor(title?: string, options?: IDownloadOptions)
	{
		super();
		this.title.label = title ?? 'Network';
		if(options?.added)
		{
			this.subscribed = options.added;
			this.subAdded = (_, list) => { };
			this.subscribed.connect(this.subAdded);
		}
		this.addClass('lm-DownloadWidget');

		// Build internal DOM skeleton
		this.node.innerHTML = `
      <div class="lm-DownloadWidget-section">
        <div class="lm-DownloadWidget-sectionHeader">Active Activity & Downloads</div>
        <ul class="lm-DownloadWidget-list active-downloads"></ul>
      </div>
      <div class="lm-DownloadWidget-section" style="border-bottom: none;">
        <div class="lm-DownloadWidget-sectionHeader">Download History</div>
        <ul class="lm-DownloadWidget-list history-downloads"></ul>
      </div>
    `;

		this.activeListContainer = this.node.querySelector('.active-downloads') as HTMLUListElement;
		this.historyListContainer = this.node.querySelector('.history-downloads') as HTMLUListElement;
	}

	/**
	 * Add or update an active/past download item programmatically.
	 */
	public upsertItem(item: DownloadItem): void
	{
		this.items.set(item.id, item);
		this.render();
	}

	/**
	 * Re-renders the lists based on current internal state.
	 */
	public render(): void
	{
		this.activeListContainer.innerHTML = '';
		this.historyListContainer.innerHTML = '';

		for(const item of this.items.values())
		{
			const li = document.createElement('li');
			li.className = `lm-DownloadWidget-item is-${item.status}`;

			const progressPercent = item.totalBytes > 0
				? Math.min(100, Math.round((item.transferredBytes / item.totalBytes) * 100))
				: 0;

			const formattedSize = this.formatBytes(item.transferredBytes);
			const totalSize = item.totalBytes > 0 ? this.formatBytes(item.totalBytes) : 'Unknown size';

			li.innerHTML = `
        <div class="lm-DownloadWidget-itemRow">
          <span class="lm-DownloadWidget-filename" title="${item.filename}">${item.filename}</span>
          <span style="font-size: 11px; color: var(--jp-ui-font-color2);">
            ${item.status === 'active' ? (item.speed || `${progressPercent}%`) : item.status}
          </span>
        </div>
        ${item.status === 'active' ? `
          <div class="lm-DownloadWidget-progressTrack">
            <div class="lm-DownloadWidget-progressBar" style="width: ${progressPercent}%;"></div>
          </div>
        ` : ''}
        <div class="lm-DownloadWidget-itemRow lm-DownloadWidget-meta">
          <span>${formattedSize} / ${totalSize}</span>
          <span>${item.timestamp}</span>
        </div>
      `;

			if(item.status === 'active')
			{
				this.activeListContainer.appendChild(li);
			} else
			{
				this.historyListContainer.appendChild(li);
			}
		}
	}

	private formatBytes(bytes: number): string
	{
		if(bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
	}
}
