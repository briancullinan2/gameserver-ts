import { getBranches } from "./github-api";
import { RepositoryToolbar } from "./menu-repos";
import { SettingConfig } from "./settings";
import { GithubWindow } from "./github.d";



const githubSelf: GithubWindow = self as unknown as any;


export function addRepoIfNotExists(newRepo: string): void
{
	if(!newRepo || newRepo.includes('briancullinan2'))
	{
		console.error('Assertion repo name is briancullinan2');
		debugger;
		return;
	}

	if(newRepo.trim().length > 0 && !RepositoryToolbar.repository?.querySelector(`option[value="${newRepo}"]`))
	{
		const option = document.createElement('option');

		option.value = newRepo;
		option.textContent = newRepo;

		RepositoryToolbar.repository?.appendChild(option);
		localStorage.setItem('repositories', Array.from(RepositoryToolbar.repository?.children ?? []).map(c => (c as HTMLOptionElement).value).join(';'));
	}
}

githubSelf.addRepoIfNotExists = addRepoIfNotExists;

export function addOwnerIfNotExists(newOwner: string): void
{
	if(newOwner.includes('Quake3e'))
	{
		console.error('Assertion owner name is Quake3e should be briancullinan2');
		debugger;
		return;
	}

	if(newOwner && newOwner.trim().length > 0 && !RepositoryToolbar.owner?.querySelector(`option[value="${newOwner}"]`))
	{
		const option = document.createElement('option');

		option.value = newOwner;
		option.textContent = newOwner;
		option.selected = true;

		RepositoryToolbar.owner?.appendChild(option);
		localStorage.setItem('owners', Array.from(RepositoryToolbar.owner?.children ?? []).map(c => (c as HTMLOptionElement).value).join(';'));
	}
}

githubSelf.addOwnerIfNotExists = addOwnerIfNotExists;

export function parseRepository(newRepo: string): [string | undefined, string | undefined]
{
	if(newRepo.trim().replace(/\/$|^\//, '').length === 0)
	{
		return [undefined, undefined];
	}
	const parts = newRepo.split('/');
	const ownerName = parts.length === 2 ? parts[0] : RepositoryToolbar.owner?.value;
	const repoName = parts.length === 2 ? parts[1] : parts[0] || RepositoryToolbar.repository?.value;

	return [ownerName, repoName];
}

export function configureRepository(newRepo: string): [string, string] | undefined
{
	const [ownerName, repoName] = parseRepository(newRepo);
	if(!ownerName || ownerName.length === 0 || !repoName || repoName.length === 0)
	{
		return;
	}

	addRepoIfNotExists(repoName);
	addOwnerIfNotExists(ownerName);

	return [ownerName, repoName];
}

export async function setRepository(newRepo: string): Promise<void>
{
	const configResult = configureRepository(newRepo);
	if(!configResult) return;

	const [ownerName, repoName] = configResult;

	if(ownerName === 'Quake3e' || ownerName === '')
	{
		console.error('Assertion: newOwner set to Quake3e should be ec- or briancullinan2');
		debugger;
	}

	if(!ownerName || ownerName.trim() === '' || !repoName || repoName.trim() === '') return;

	if(RepositoryToolbar.owner)
	{
		RepositoryToolbar.owner.value = ownerName;
	}
	if(RepositoryToolbar.repository)
	{
		RepositoryToolbar.repository.value = repoName;
	}

	const branches = await getBranches(RepositoryToolbar.owner?.value, RepositoryToolbar.repository?.value);
	updateSelectOptions(RepositoryToolbar.branch, branches);
}




interface NormalizedSelectItem
{
	value: string;
	text: string;
}

export interface GitHubBranchLike
{
	name: string;
	[key: string]: any;
}

export function updateSelectOptions(
	elementId: string | Element | undefined | null,
	items: Record<string, string> | Array<string | GitHubBranchLike>,
	selectedValue: string = 'main'
): void
{
	if(!elementId)
	{
		return;
	}
	const selector = elementId instanceof Element
		? (elementId as HTMLSelectElement)
		: (document.getElementById(elementId) as HTMLSelectElement | null);

	if(!selector) return;

	// 1. Clear existing options
	selector.innerHTML = '';

	// 2. Normalize input items into a standard loopable collection
	let normalizedItems: NormalizedSelectItem[] = [];

	if(items && typeof items === 'object' && !Array.isArray(items))
	{
		// Handle key: value pair object (Dictionary)
		normalizedItems = Object.entries(items).map(([key, val]) => ({
			value: key,
			text: val
		}));
	} else if(Array.isArray(items))
	{
		// Handle flat arrays of strings or GitHub/Engine branch objects
		normalizedItems = items.map(item =>
		{
			const name = typeof item === 'object' && item !== null ? item.name : (item as string);
			return {
				value: name,
				text: name
			};
		});
	}

	const seenValues = new Set<string>();
	normalizedItems = normalizedItems.filter(item =>
	{
		if(seenValues.has(item.value))
		{
			return false; // Skip duplicate values
		}
		seenValues.add(item.value);
		return true;
	});

	normalizedItems.sort((a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base' }));

	// 3. Create and append normalized entries
	normalizedItems.forEach(item =>
	{
		if(selector.querySelector(`option[value="${item.value}"]`))
		{
			return;
		}

		const option = document.createElement('option');

		option.value = item.value;
		option.textContent = item.text;

		// Check matching state against the intended target option value
		if(item.value === selectedValue || item.text === selectedValue)
		{
			option.selected = true;
		}

		selector.appendChild(option);
	});

	// 4. Force layout recalculation
	// This helps with the "wont shrink" issue if the new text is shorter
	selector.style.minWidth = '0';
}


githubSelf.updateSelectOptions = updateSelectOptions;


const LOCAL_SETTINGS: Record<string, Record<string, SettingConfig>> = {
	github: {
		githubToken: {
			key: 'github_token',
			default: '',
			description: 'Personal GitHub Access Token used to authenticate API requests, bypass rate limits, and securely fetch repository source files or assets.',
			set: (val: string): void =>
			{
				if(typeof githubSelf.api === 'undefined') return;
				githubSelf.api.github_token = val; // share with worker
			}
		},
		ownersList: {
			key: 'owners',
			default: ['briancullinan2', 'ec-'],
			elementId: RepositoryToolbar.owner?.id,
			type: 'csv', // Semicolon separated array mapping
			description: 'A list of authorized GitHub organization names or usernames hosting the source code and forks relevant to this project environment.',
			set: (val: string[]): void =>
			{
				updateSelectOptions(RepositoryToolbar.owner, val);
			}
		},
		repositoriesList: {
			key: 'repositories',
			default: ['Quake3e', 'baseq3a'],
			elementId: RepositoryToolbar.repository?.id,
			type: 'csv',
			description: 'Comma/semicolon-separated list of target GitHub repository names available for compilation selection.',
			set: (val: string[]): void =>
			{
				updateSelectOptions(RepositoryToolbar.repository, val);
			}
		},
		defaultRepository: {
			key: 'default_repository',
			default: 'briancullinan2/Quake3e',
			elementId: RepositoryToolbar.repository?.id,
			description: 'The fallback or preferred primary repository string formatted as "owner/repo" used when loading the workspace workspace initial state.',
			get: (storage: string | null, defaultRepo: string): string =>
			{
				return RepositoryToolbar.owner?.value && RepositoryToolbar.repository?.value
					? `${RepositoryToolbar.owner.value}/${RepositoryToolbar.repository.value}`
					: (storage || defaultRepo);
			},
			set: setRepository
		},
		engineRepository: {
			key: 'engine_repository',
			default: 'briancullinan2/Quake3e',
			description: 'The specific Git repository designated for compiling the core Quake 3 WebAssembly engine architecture.',
			set: configureRepository
		},
		gameRepository: {
			key: 'game_repository',
			default: 'briancullinan2/baseq3a',
			description: 'The repository source housing the game logic mod components, including cgame, game, and ui modules.',
			set: configureRepository
		},
		assetRepository: {
			key: 'asset_repository',
			default: 'briancullinan2/multigame-assets',
			description: 'Optional storage repository dedicated to static game assets, maps, texturing bundles, or audio assets required to run the game.',
			set: configureRepository
		},
		toolsRepository: {
			key: 'tools_repository',
			default: 'briancullinan2/q3lcc',
			description: 'Primary compiler tooling repository containing components such as q3lcc (the Quake 3 ANSI C compiler targeting virtual machine bytecode).',
			set: configureRepository
		},
		tools2Repository: {
			key: 'tools_repository',
			default: 'ec-/q3asm',
			description: 'Secondary toolchain repository hosting utilities like q3asm to assemble the intermediate bytecode files into final .qvm files.',
			set: configureRepository
		},
		rendererRepository: {
			key: 'renderer_repository',
			default: 'briancullinan2/Quake3e',
			description: 'Repository handling the graphical subsystems and pipeline routines tasked with translating engine calculations to browser contexts.',
			set: configureRepository
		},
		environmentRepository: {
			key: 'environment_repository',
			default: 'briancullinan2/gameserver-ts',
			description: 'Repository for this workspace, the entire IDE, code editor and engine runner, for editing the environment inside the workspace.',
			set: configureRepository
		},
		environmentVersion: {
			key: 'environment_version',
			default: new Date(0),
			description: 'The last commit date for the environment repository set automatically.',
		},

	}
};

if(!githubSelf.IMPORT_SETTINGS)
{
	githubSelf.IMPORT_SETTINGS = {};
}

for(const [moduleKey, configs] of Object.entries(LOCAL_SETTINGS))
{
	githubSelf.IMPORT_SETTINGS[moduleKey] = {
		...(githubSelf.IMPORT_SETTINGS[moduleKey] || {}),
		...configs
	};
}

// 4. Export the unified reference for standard module compilation tracking
export const IMPORT_SETTINGS = githubSelf.IMPORT_SETTINGS;


