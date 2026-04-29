// Apply saved theme before React mounts to avoid a flash of wrong colors.
(() => {
  const stored = localStorage.getItem('theme');
  const effective = (!stored || stored === 'auto')
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : stored;
  document.documentElement.setAttribute('data-bs-theme', effective);
})();
