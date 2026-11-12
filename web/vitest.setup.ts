// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom/vitest';

import { vi } from 'vitest';

// Accessibility is asserted in Playwright (real browser) via @axe-core/playwright,
// not in jsdom — see testing-policy.md § Where each scenario belongs. So there is
// no `vitest-axe` matcher to register here.

// React Testing Library ⇄ Vitest fake-timers safety net.
//
// Time-dependent *flows* (session timeout, polling, countdowns) belong in
// Playwright via `page.clock` — see testing-policy.md § Time-dependent behaviour.
// This shim only backstops the rare component-local `vi.useFakeTimers()` test:
// RTL's `waitFor`/`findBy*` only advance fake timers when it detects Jest's
// globals (`jestFakeTimersAreEnabled()` checks for a `jest` object + mocked
// `setTimeout`). Under Vitest the timers are mocked (Sinon `setTimeout.clock`)
// but there is no `jest` global, so RTL falls back to REAL-timer polling that
// never fires under a frozen fake clock → `waitFor`/`findBy*` deadlock.
//
// Exposing a minimal `globalThis.jest` shim backed by Vitest's timer API closes
// that gap. RTL only consults it when fake timers are actually active, so suites
// on real timers are unaffected. Test-environment only — no production code is
// touched. (Do NOT run `axe()` under fake timers — assert a11y on a real-timer
// render instead; that's why this file no longer needs an axe/`setTimeout` shim.)
if (typeof (globalThis as { jest?: unknown }).jest === 'undefined') {
  (globalThis as { jest?: unknown }).jest = {
    advanceTimersByTime: (durationMs: number) =>
      void vi.advanceTimersByTime(durationMs),
  };
}

// Polyfill for Web APIs needed by Next.js
// These are required for testing files that import from 'next/server'
if (typeof Request === 'undefined') {
  global.Request = class Request {
    url: string;
    method: string;
    headers: Headers;

    constructor(input: string | Request, init?: RequestInit) {
      this.url = typeof input === 'string' ? input : input.url;
      this.method = init?.method || 'GET';
      this.headers = new Headers(init?.headers);
    }
  } as unknown as typeof Request;
}

if (typeof Response === 'undefined') {
  global.Response = class Response {
    status: number;
    statusText: string;
    headers: Headers;
    body: unknown;

    constructor(body?: BodyInit | null, init?: ResponseInit) {
      this.body = body;
      this.status = init?.status || 200;
      this.statusText = init?.statusText || 'OK';
      this.headers = new Headers(init?.headers);
    }

    json() {
      return Promise.resolve(JSON.parse(this.body as string));
    }
  } as unknown as typeof Response;
}

if (typeof Headers === 'undefined') {
  global.Headers = class Headers {
    private headers: Map<string, string> = new Map();

    constructor(init?: HeadersInit) {
      if (init) {
        if (Array.isArray(init)) {
          init.forEach(([key, value]) =>
            this.headers.set(key.toLowerCase(), value),
          );
        } else if (init instanceof Headers) {
          init.forEach((value, key) => this.headers.set(key, value));
        } else {
          Object.entries(init).forEach(([key, value]) =>
            this.headers.set(key.toLowerCase(), value),
          );
        }
      }
    }

    get(name: string) {
      return this.headers.get(name.toLowerCase()) || null;
    }

    set(name: string, value: string) {
      this.headers.set(name.toLowerCase(), value);
    }

    has(name: string) {
      return this.headers.has(name.toLowerCase());
    }

    delete(name: string) {
      this.headers.delete(name.toLowerCase());
    }

    forEach(callback: (value: string, key: string, parent: Headers) => void) {
      this.headers.forEach((value, key) => callback(value, key, this));
    }
  } as unknown as typeof Headers;
}

// jsdom implements no observer APIs. Radix's popper primitives call `new ResizeObserver`
// unconditionally (via @radix-ui/react-use-size, used by every Arrow-bearing content —
// Tooltip and HoverCard out of the box), so the first test that opens one dies with a
// ReferenceError that reads like a component bug. jsdom does no layout, so a no-op is
// honest: there is genuinely no size change to report. Positioning is asserted in Playwright.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
}

// Node 25+ ships its own experimental global `localStorage` / `sessionStorage`, which
// is undefined unless Node runs with --localstorage-file. That global shadows jsdom's
// Web Storage, so `window.localStorage` is undefined in tests. When storage is missing,
// install an in-memory Storage with the standard API — honest for jsdom, which never
// persists storage across runs anyway.
class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(String(key)) ?? null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.entries.set(String(key), String(value));
  }
}

for (const storageName of ['localStorage', 'sessionStorage'] as const) {
  if (!globalThis[storageName]) {
    Object.defineProperty(globalThis, storageName, {
      configurable: true,
      value: new MemoryStorage(),
    });
  }
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  class IntersectionObserverStub {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  globalThis.IntersectionObserver =
    IntersectionObserverStub as unknown as typeof IntersectionObserver;
}
