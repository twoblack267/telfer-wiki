import fs from 'fs';

let html = fs.readFileSync('src/layouts/BaseLayout.astro', 'utf8');

// Add flash-prevention script in head (before </head>)
const darkScript = `<script is:inline>
      (function() {
        var saved = localStorage.getItem('telfer-wiki-theme');
        var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (saved === 'dark' || (!saved && prefersDark)) {
          document.documentElement.setAttribute('data-theme', 'dark');
        }
      })();
    </script>
  </head>`;

html = html.replace('</head>', darkScript);

// Add dark mode toggle button before hamburger button
const navEnd = '        <!-- Hamburger button -->';
const toggleBtn = `        <!-- Dark Mode Toggle -->
        <button id="theme-toggle" class="p-2 rounded-lg text-[var(--color-ink-light)] hover:text-[var(--color-burgundy)] hover:bg-[var(--color-surface)] transition-colors" aria-label="Toggle dark mode" title="Toggle dark/light mode">
          <svg id="theme-icon-sun" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          <svg id="theme-icon-moon" class="hidden" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        </button>
        `;
html = html.replace(navEnd, toggleBtn + navEnd);

// Replace bg-white/80 and bg-white/95 with inline styles using CSS vars
html = html.replace(
  'bg-white/80 backdrop-blur-sm',
  'style="background:var(--color-nav-bg);backdrop-filter:blur(12px)"'
);
html = html.replace(
  'bg-white/95 backdrop-blur-sm',
  'style="background:var(--color-nav-bg);backdrop-filter:blur(12px)"'
);

// Add dark mode styles to the inline <style> block
const darkStyles = `
  /* ── Dark mode overrides ──────────────────────────── */
  [data-theme="dark"] body {
    background-color: var(--color-paper);
    color: var(--color-ink);
  }
  [data-theme="dark"] .person-card {
    background: var(--color-card-bg);
  }
  [data-theme="dark"] .person-card:hover {
    box-shadow: 0 2px 12px rgba(0,0,0,0.25);
  }
  [data-theme="dark"] .search-input {
    background: var(--color-input-bg);
    color: var(--color-ink);
  }
  [data-theme="dark"] .badge-living {
    background: #1a3a1a;
    color: #7fd18f;
    border-color: #2a5a2a;
  }
  [data-theme="dark"] .badge-deceased {
    background: var(--color-surface);
    color: var(--color-muted);
    border-color: var(--color-border);
  }
  [data-theme="dark"] img {
    opacity: 0.9;
  }
  [data-theme="dark"] ::selection {
    background: var(--color-burgundy);
    color: white;
  }

  /* Smooth transitions for theme changes */
  body, .person-card, .search-input, nav, footer {
    transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease;
  }
`;

html = html.replace('</style>', darkStyles + '\n</style>');

// Add theme toggle script
const toggleScript = `
  // ── Dark mode toggle ──
  const themeToggle = document.getElementById('theme-toggle');
  const sunIcon = document.getElementById('theme-icon-sun');
  const moonIcon = document.getElementById('theme-icon-moon');

  function setTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      if (sunIcon) sunIcon.classList.add('hidden');
      if (moonIcon) moonIcon.classList.remove('hidden');
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (sunIcon) sunIcon.classList.remove('hidden');
      if (moonIcon) moonIcon.classList.add('hidden');
    }
    localStorage.setItem('telfer-wiki-theme', theme);
  }

  if (themeToggle) {
    // Set initial icon state
    const currentTheme = document.documentElement.getAttribute('data-theme');
    if (currentTheme === 'dark') {
      if (sunIcon) sunIcon.classList.add('hidden');
      if (moonIcon) moonIcon.classList.remove('hidden');
    }

    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      setTheme(isDark ? 'light' : 'dark');
    });

    // Listen for system preference changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem('telfer-wiki-theme')) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    });
  }
`;

// Insert toggle script before the last nav toggle's closing script tag
html = html.replace('</script>', toggleScript + '\n  </script>');

fs.writeFileSync('src/layouts/BaseLayout.astro', html);
console.log('✅ BaseLayout.astro updated with dark mode toggle');
