import { describe, expect, it, afterEach, vi } from 'vitest';
import ParsedRule from '../../src/inc/ParsedRule.js';
import Logger from '../../src/inc/Logger.js';
import { spyOnConsole, stubGlobalDocument } from './inc/helpers.js';
import Swup from 'swup';
import { stubVisit } from '../../src/inc/functions.js';

describe('ParsedRule', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});
	it('should have correct defaults', () => {
		const rule = new ParsedRule({
			from: '/users/',
			to: '/user/:slug',
			containers: [' #fragment-1'],
			swup: new Swup()
		});

		// expect valid matchesFrom and matchesTo functions
		expect(Boolean(rule.matchesFrom('/users/'))).toBe(true);
		expect(Boolean(rule.matchesTo('/user/john'))).toBe(true);
		expect(rule.matchesFrom('/')).toBe(false);
		expect(rule.matchesTo('/')).toBe(false);

		// expect sanitized selectors
		expect(rule.containers).toEqual(['#fragment-1']);

		expect(rule.scroll).toBe(false);
		expect(rule.name).toBe(undefined);
		expect(rule.focus).toBe(undefined);
		expect(rule.logger).toBe(undefined);
	});

	it('should parse all provided options', () => {
		const rule1 = new ParsedRule({
			from: '(.*)',
			to: '(.*)',
			containers: ['#fragment-1'],
			name: 'test',
			scroll: '#top',
			focus: 'main',
			swup: new Swup()
		});
		expect(rule1.name).toEqual('test');
		expect(rule1.scroll).toEqual('#top');
		expect(rule1.focus).toEqual('main');

		const rule2 = new ParsedRule({
			from: '(.*)',
			to: '(.*)',
			containers: ['#fragment-1'],
			scroll: true,
			focus: false,
			swup: new Swup()
		});
		expect(rule2.scroll).toEqual(true);
		expect(rule2.focus).toEqual(false);
	});

	it('should log an error if containers is empty', () => {
		const console = spyOnConsole();
		new ParsedRule({
			from: '(.*)',
			to: '(.*)',
			containers: [],
			swup: new Swup(),
			logger: new Logger()
		});
		expect(console.error).toBeCalledWith('Every fragment rule must contain an array of containers', expect.any(Object)); // prettier-ignore
	});

	it('should validate container selectors and log errors', () => {
		const console = spyOnConsole();
		const rule = new ParsedRule({
			from: '(.*)',
			to: '(.*)',
			containers: ['.fragment-1', '#swup #fragment-2'],
			swup: new Swup(),
			logger: new Logger()
		});
		expect(console.error).toBeCalledTimes(2);
		expect(rule.containers).toEqual([]);

		expect(console.error).toBeCalledWith(new Error(`fragment selectors must be IDs: .fragment-1`)); // prettier-ignore
		expect(console.error).toBeCalledWith(new Error(`fragment selectors must not be nested: #swup #fragment-2`)); // prettier-ignore
	});

	it('should correctly match a rule', () => {
		stubGlobalDocument(
			/*html*/ `<div id="swup" class="transition-main"><div id="fragment-1"></div></div>`
		);
		const rule = new ParsedRule({
			from: '/users/',
			to: '/user/:slug',
			containers: ['#fragment-1'],
			swup: new Swup(),
			if: (visit) => true
		});
		const visit = stubVisit({ to: '' });
		expect(rule.matches({ from: '/users/', to: '/user/jane' }, visit)).toBe(true);
		expect(rule.matches({ from: '/users/', to: '/users/' }, visit)).toBe(false);
		expect(rule.matches({ from: '/user/jane', to: '/users/' }, visit)).toBe(false);
		expect(rule.matches({ from: '/user/jane', to: '/user/john' }, visit)).toBe(false);

		/** Respect rule.if */
		rule.if = (visit) => false;
		expect(rule.matches({ from: '/users/', to: '/user/jane' }, visit)).toBe(false);
	});

	it('should validate selectors if matching a rule', () => {
		const console = spyOnConsole();
		const rule = new ParsedRule({
			from: '(.*)',
			to: '(.*)',
			containers: ['#fragment-1'],
			swup: new Swup(),
			logger: new Logger()
		});
		const visit = stubVisit({ to: '' });

		/** fragment element missing */
		stubGlobalDocument(/*html*/ `<div id="swup" class="transition-main"></div>`);
		expect(rule.matches({ from: '/foo/', to: '/bar/' }, visit)).toBe(false);
		expect(console.error).toBeCalledWith(new Error('skipping rule since #fragment-1 doesn\'t exist in the current document'), expect.any(Object)) // prettier-ignore

		/** fragment element outside of swup's default containers */
		stubGlobalDocument(
			/*html*/ `<div id="swup" class="transition-main"></div><div id="fragment-1"></div>`
		);
		expect(rule.matches({ from: '/foo/', to: '/bar/' }, visit)).toBe(false);
		expect(console.error).toBeCalledWith(new Error('skipping rule since #fragment-1 is outside of swup\'s default containers'), expect.any(Object)) // prettier-ignore
	});

	describe('Search Parameter Matching', () => {
		it('should match when search parameters change on same URL', () => {
			stubGlobalDocument(
				/*html*/ `<div id="swup" class="transition-main"><div id="fragment-1"></div></div>`
			);

			const rule = new ParsedRule({
				from: '/products/(.*)',
				to: '/products/(.*)',
				containers: ['#fragment-1'],
				watchSearchParams: true,
				swup: new Swup()
			});

			const visit = stubVisit({ to: '' });

			// Should match when search params change on same URL
			expect(
				rule.matches(
					{
						from: '/products/shirt',
						to: '/products/shirt?variant=123'
					},
					visit
				)
			).toBe(true);

			expect(
				rule.matches(
					{
						from: '/products/shirt?variant=123',
						to: '/products/shirt?variant=456'
					},
					visit
				)
			).toBe(true);

			// Should not match when URLs are completely different
			expect(
				rule.matches(
					{
						from: '/products/shirt',
						to: '/collections/all'
					},
					visit
				)
			).toBe(false);
		});

		it('should match specific search parameters only', () => {
			stubGlobalDocument(
				/*html*/ `<div id="swup" class="transition-main"><div id="fragment-1"></div></div>`
			);

			const rule = new ParsedRule({
				from: '/collections/(.*)',
				to: '/collections/(.*)',
				containers: ['#fragment-1'],
				watchSearchParams: ['filter.p.product_type', 'filter.v.option.color'],
				swup: new Swup()
			});

			const visit = stubVisit({ to: '' });

			// Should match when watched params change
			expect(
				rule.matches(
					{
						from: '/collections/all',
						to: '/collections/all?filter.p.product_type=shoes'
					},
					visit
				)
			).toBe(true);

			expect(
				rule.matches(
					{
						from: '/collections/all?filter.p.product_type=shoes',
						to: '/collections/all?filter.v.option.color=red'
					},
					visit
				)
			).toBe(true);

			// Should not match when non-watched params change
			expect(
				rule.matches(
					{
						from: '/collections/all',
						to: '/collections/all?sort_by=price'
					},
					visit
				)
			).toBe(false);
		});

		it('should not match search param changes when watchSearchParams is not set', () => {
			stubGlobalDocument(
				/*html*/ `<div id="swup" class="transition-main"><div id="fragment-1"></div></div>`
			);

			const rule = new ParsedRule({
				from: '/products/(.*)',
				to: '/products/(.*)',
				containers: ['#fragment-1'],
				swup: new Swup()
			});

			const visit = stubVisit({ to: '' });

			// Should not match search param changes when watchSearchParams is not enabled
			expect(
				rule.matches(
					{
						from: '/products/shirt',
						to: '/products/shirt?variant=123'
					},
					visit
				)
			).toBe(false);
		});

		it('should combine traditional matching with search param matching', () => {
			stubGlobalDocument(
				/*html*/ `<div id="swup" class="transition-main"><div id="fragment-1"></div></div>`
			);

			const rule = new ParsedRule({
				from: '/products/(.*)',
				to: '/products/(.*)',
				containers: ['#fragment-1'],
				watchSearchParams: ['variant'],
				swup: new Swup()
			});

			const visit = stubVisit({ to: '' });

			// Should match traditional route changes
			expect(
				rule.matches(
					{
						from: '/products/shirt',
						to: '/products/pants'
					},
					visit
				)
			).toBe(true);

			// Should also match search param changes
			expect(
				rule.matches(
					{
						from: '/products/shirt',
						to: '/products/shirt?variant=123'
					},
					visit
				)
			).toBe(true);
		});

		it('should handle Shopify filter parameters correctly', () => {
			stubGlobalDocument(
				/*html*/ `<div id="swup" class="transition-main"><div id="fragment-1"></div></div>`
			);

			const rule = new ParsedRule({
				from: '/collections/(.*)',
				to: '/collections/(.*)',
				containers: ['#fragment-1'],
				watchSearchParams: true, // Watch all Shopify filter params
				swup: new Swup()
			});

			const visit = stubVisit({ to: '' });

			// Test various Shopify filter parameter combinations
			expect(
				rule.matches(
					{
						from: '/collections/all',
						to: '/collections/all?filter.p.product_type=shoes'
					},
					visit
				)
			).toBe(true);

			expect(
				rule.matches(
					{
						from: '/collections/all?filter.p.product_type=shoes',
						to: '/collections/all?filter.p.product_type=shoes&filter.v.option.color=red'
					},
					visit
				)
			).toBe(true);

			expect(
				rule.matches(
					{
						from: '/collections/all?filter.v.option.color=red',
						to: '/collections/all?filter.v.option.color=blue'
					},
					visit
				)
			).toBe(true);

			expect(
				rule.matches(
					{
						from: '/collections/all?filter.v.price.gte=10&filter.v.price.lte=50',
						to: '/collections/all?filter.v.price.gte=20&filter.v.price.lte=100'
					},
					visit
				)
			).toBe(true);
		});
	});
});
