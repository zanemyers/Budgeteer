import { createInertiaApp } from "@inertiajs/react";
import { createRoot } from "react-dom/client";

createInertiaApp({
  resolve: (name) => {
    const pages = import.meta.glob("./pages/**/*.tsx", { eager: true }) as Record<
      string,
      { default: React.ComponentType }
    >;
    const page = pages[`./pages/${name}.tsx`];
    if (!page) {
      throw new Error(`Inertia page not found: ${name}`);
    }
    return page;
  },
  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />);
  },
});
