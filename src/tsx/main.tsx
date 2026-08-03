import { createInertiaApp } from "@inertiajs/react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import AppLayout from "./layouts/AppLayout";

document.addEventListener("DOMContentLoaded", () => {
  createInertiaApp({
    resolve: (name) => {
      const pages = import.meta.glob("./pages/**/*.tsx", { eager: true }) as Record<
        string,
        { default: React.ComponentType & { layout?: (page: React.ReactNode) => React.ReactNode } }
      >;
      const page = pages[`./pages/${name}.tsx`];
      // Apply AppLayout as the default persistent layout unless a page defines its own.
      page.default.layout ??= (page) => createElement(AppLayout, null, page);
      return page;
    },
    setup({ el, App, props }) {
      createRoot(el).render(createElement(App, props));
    },
  });
});
