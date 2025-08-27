import { matchPath, classify, Location } from 'swup';
import type { Swup, Path, Visit } from 'swup';
import type { Route, Rule, Predicate, ParsedRuleOptions } from './defs.js';
import { dedupe, queryFragmentElement } from './functions.js';
import Logger, { highlight } from './Logger.js';
import { __DEV__ } from './env.js';

// Use ParsedRuleOptions from defs.js
type Options = ParsedRuleOptions;

/**
 * Represents a Rule
 */
export default class ParsedRule {
	readonly matchesFrom: ReturnType<typeof matchPath>;
	readonly matchesTo: ReturnType<typeof matchPath>;

	swup: Swup;
	from: Path;
	to: Path;
	containers: string[];
	name?: string;
	scroll: boolean | string = false;
	focus?: boolean | string;
	logger?: Logger;
	if: Predicate = () => true;
	watchSearchParams?: boolean | string[];

	constructor(options: Options) {
		this.swup = options.swup;
		this.logger = options.logger;
		this.from = options.from || '';
		this.to = options.to || '';

		if (options.name) this.name = classify(options.name);
		if (typeof options.scroll !== 'undefined') this.scroll = options.scroll;
		if (typeof options.focus !== 'undefined') this.focus = options.focus;
		if (typeof options.if === 'function') this.if = options.if;
		if (typeof options.watchSearchParams !== 'undefined')
			this.watchSearchParams = options.watchSearchParams;

		this.containers = this.parseContainers(options.containers);

		if (__DEV__) {
			this.logger?.errorIf(!this.to, `Every fragment rule must contain a 'to' path`, this);
			this.logger?.errorIf(!this.from, `Every fragment rule must contain a 'from' path`, this); // prettier-ignore
		}

		this.matchesFrom = matchPath(this.from);
		this.matchesTo = matchPath(this.to);
	}

	/**
	 * Parse provided fragment containers
	 */
	parseContainers(rawContainers: string[]): string[] {
		if (!Array.isArray(rawContainers) || !rawContainers.length) {
			// prettier-ignore
			if (__DEV__) this.logger?.error(`Every fragment rule must contain an array of containers`, this.getDebugInfo());
			return [];
		}
		// trim selectors
		const containers = dedupe(rawContainers.map((selector) => selector.trim()));
		return containers.filter((selector) => {
			const result = this.validateSelector(selector);
			this.logger?.errorIf(result instanceof Error, result);
			return result === true;
		});
	}

	/**
	 * Validate a fragment selector
	 *
	 * - only IDs are allowed
	 * - no nested selectors
	 */
	validateSelector(selector: string): true | Error {
		if (!selector.startsWith('#')) {
			return new Error(`fragment selectors must be IDs: ${selector}`);
		}

		if (selector.match(/\s|>/)) {
			return new Error(`fragment selectors must not be nested: ${selector}`);
		}
		return true;
	}

	/**
	 * Get debug info for logging
	 */
	getDebugInfo() {
		const { from, to, containers, watchSearchParams } = this;
		return {
			from: String(from),
			to: String(to),
			containers: String(containers),
			watchSearchParams: watchSearchParams ? String(watchSearchParams) : undefined
		};
	}

	/**
	 * Check if search parameters have changed between two URLs
	 */
	private hasSearchParamsChanged(fromUrl: string, toUrl: string): boolean {
		if (!this.watchSearchParams) return false;

		const fromLocation = Location.fromUrl(fromUrl);
		const toLocation = Location.fromUrl(toUrl);

		// If pathnames are different, this is not a search param only change
		if (fromLocation.pathname !== toLocation.pathname) return false;

		if (this.watchSearchParams === true) {
			// Watch all search params - return true if any search params differ
			return fromLocation.search !== toLocation.search;
		}

		if (Array.isArray(this.watchSearchParams)) {
			// Watch specific search params - return true if any watched param differs
			return this.watchSearchParams.some((param) => {
				const fromValue = fromLocation.searchParams.get(param);
				const toValue = toLocation.searchParams.get(param);
				return fromValue !== toValue;
			});
		}

		return false;
	}

	/**
	 * Check if this is a search parameter change on the same base URL
	 */
	private isSearchParamOnlyChange(route: Route): boolean {
		if (!this.watchSearchParams) return false;

		const { url: fromUrl } = Location.fromUrl(route.from);
		const { url: toUrl } = Location.fromUrl(route.to);

		// For search param changes on the same URL, both URLs should match both patterns
		// Since 'from' and 'to' patterns are often the same (e.g., '/products/(.*)')
		const fromMatchesFromPattern = !!this.matchesFrom(fromUrl);
		const fromMatchesToPattern = !!this.matchesTo(fromUrl);
		const toMatchesFromPattern = !!this.matchesFrom(toUrl);
		const toMatchesToPattern = !!this.matchesTo(toUrl);

		// For search param changes, both URLs should match at least one of our patterns
		const bothUrlsMatchPattern =
			(fromMatchesFromPattern || fromMatchesToPattern) &&
			(toMatchesFromPattern || toMatchesToPattern);

		if (!bothUrlsMatchPattern) return false;

		return this.hasSearchParamsChanged(route.from, route.to);
	}

	/**
	 * Checks if a given route matches this rule
	 */
	public matches(route: Route, visit: Visit): boolean {
		if (!this.if(visit)) {
			if (__DEV__) {
				this.logger?.log(`ignoring fragment rule due to custom rule.if:`, this);
			}
			return false;
		}

		const { url: fromUrl } = Location.fromUrl(route.from);
		const { url: toUrl } = Location.fromUrl(route.to);

		// Check for search parameter changes on the same base URL first
		const matchesSearchParamChange = this.isSearchParamOnlyChange(route);

		// Check for traditional route matching (different URLs)
		// But exclude cases where it's just a search param change without watchSearchParams enabled
		const matchesRoute = !!this.matchesFrom(fromUrl) && !!this.matchesTo(toUrl);

		// If URLs have same pathname but different search params, only allow search param matching
		const fromLocation = Location.fromUrl(route.from);
		const toLocation = Location.fromUrl(route.to);
		const samePathname = fromLocation.pathname === toLocation.pathname;
		const differentSearchParams = fromLocation.search !== toLocation.search;

		if (samePathname && differentSearchParams) {
			// This is a search param change - only match if watchSearchParams allows it
			if (!matchesSearchParamChange) {
				return false;
			}

			// Log debug info for search param changes
			if (__DEV__) {
				this.logger?.log(
					`fragment rule matched due to search parameter change:`,
					this.getDebugInfo()
				);
			}
		} else {
			// For different pathnames, use traditional route matching
			if (!matchesRoute) {
				return false;
			}
		}

		// Validate selectors for the matched rule
		for (const selector of this.containers) {
			const result = this.validateFragmentSelectorForMatch(selector);
			if (result instanceof Error) {
				if (__DEV__) this.logger?.error(result, this.getDebugInfo());
				return false;
			}
		}

		return true;
	}

	/**
	 * Validates a fragment element at runtime when this rule's route matches
	 */
	validateFragmentSelectorForMatch(selector: string): true | Error {
		if (!document.querySelector(selector)) {
			// prettier-ignore
			return new Error(`skipping rule since ${highlight(selector)} doesn't exist in the current document`);
		}
		if (!queryFragmentElement(selector, this.swup)) {
			// prettier-ignore
			return new Error(`skipping rule since ${highlight(selector)} is outside of swup's default containers`);
		}
		return true;
	}
}
