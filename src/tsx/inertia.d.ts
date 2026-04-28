import "@inertiajs/react";

declare module "@inertiajs/react" {
  interface PageProps {
    auth: {
      user: {
        id: number;
        email: string;
        name: string;
        gravatar: string;
      };
    };
    flash: Array<{ level: string; message: string }>;
  }
}
