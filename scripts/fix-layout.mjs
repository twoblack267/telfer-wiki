import fs from 'fs';

let html = fs.readFileSync('src/layouts/BaseLayout.astro', 'utf8');

// 1. Clean up the head — remove the misplaced toggle script, keep only flash prevention
// The flash prevention script should be clean: just check and set attribute, nothing else
const cleanHeadScript = `<script is:inline>
      (function() {
        var saved = localStorage.getItem('telfer-wiki-theme');
        var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (saved === 'dark' || (!saved && prefersDark)) {
          document.documentElement.setAttribute('data-theme', 'dark');
        }
      })();
    </script>
  </head>`;

// Find the current script block and replace it
html = html.replace(
  /<script is:inline>[\s\S]*?<\/script>\s*<\/head>/,
  cleanHeadScript
);

// 2. Add "Families" to desktop nav
html = html.replace(
  'href="/telfer-wiki/search">Search</a>',
  'href="/telfer-wiki/search">Search</a>\n          <a href="/telfer-wiki/people/families" class="nav-link" class:list={[currentPath.startsWith("/telfer-wiki/people/families") && "active"]}>Families</a>'
);

// 3. Add "Families" to mobile nav
html = html.replace(
  'href="/telfer-wiki/search">🔍 Search</a>',
  'href="/telfer-wiki/search">🔍 Search</a>\n          <a href="/telfer-wiki/people/families" class="nav-link block py-2.5 px-3 rounded-lg hover:bg-[var(--color-surface)] transition-colors" class:list={[currentPath.startsWith("/telfer-wiki/people/families") && "active"]}>👪 Families</a>'
);

// 4. Update .person-card background to use CSS variable instead of hardcoded white
html = html.replace(
  '.person-card { background: white; border: 1px solid var(--color-border); transition: box-shadow 0.2s, border-color 0.2s; }',
  '.person-card { background: var(--color-card-bg); border: 1px solid var(--color-border); transition: box-shadow 0.2s, border-color 0.2s; }'
);

// 5. Add dark mode toggle script to the bottom <script> block (before nav toggle)
const themeToggleScript = `
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
    var currentTheme = document.documentElement.getAttribute('data-theme');
    if (currentTheme === 'dark') {
      if (sunIcon) sunIcon.classList.add('hidden');
      if (moonIcon) moonIcon.classList.remove('hidden');
    }

    themeToggle.addEventListener('click', function() {
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      setTheme(isDark ? 'light' : 'dark');
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
      if (!localStorage.getItem('telfer-wiki-theme')) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    });
  }
`;

// Insert after the first opening <script> tag (the nav toggle)
html = html.replace(
  '<script>\n  const toggle = document.getElementById(\'nav-toggle\');',
  '<script>\n' + themeToggleScript + '\n  const toggle = document.getElementById(\'nav-toggle\');'
);

fs.writeFileSync('src/layouts/BaseLayout.astro', html);
console.log('✅ Fixed: head script, nav links, card background, toggle script placement');
