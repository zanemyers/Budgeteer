import { createInertiaApp } from "@inertiajs/react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import AppLayout from "./layouts/AppLayout";

// Registered after load so it never competes with the first render for bandwidth. It fails on any
// insecure origin — which is every host but localhost until the deployment has TLS — and the app is
// fully usable without it, so a failure is logged and otherwise ignored.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  createInertiaApp({
    // Not `eager: true`. Eager pulled all sixteen pages into one chunk, so a visitor on the public
    // landing page downloaded the whole authenticated app — Transactions and Dashboard alone are
    // over a third of the source. Lazily each page is its own chunk, fetched on the navigation that
    // needs it; `resolve` may return a promise, which Inertia awaits before mounting.
    //
    // The extra chunk costs one round trip on a cold first load, and buys it back immediately: the
    // service worker precaches every emitted chunk (built_asset_urls walks the whole manifest) and
    // serves them cache-first, so every later navigation reads from disk rather than the network.
    resolve: (name) => {
      const pages = import.meta.glob("./pages/**/*.tsx") as Record<
        string,
        () => Promise<{ default: React.ComponentType & { layout?: (page: React.ReactNode) => React.ReactNode } }>
      >;
      // Resolves to the component rather than the module: Inertia's ComponentResolver accepts a
      // bare component, a promise of one, or a synchronous `{ default }` module — but not a promise
      // of a module, so awaiting the import and handing back `.default` is what types cleanly.
      return pages[`./pages/${name}.tsx`]().then((module) => {
        // Apply AppLayout as the default persistent layout unless a page defines its own.
        module.default.layout ??= (page) => createElement(AppLayout, null, page);
        return module.default;
      });
    },
    setup({ el, App, props }) {
      createRoot(el).render(createElement(App, props));
    },
  });
});
