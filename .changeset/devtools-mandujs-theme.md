---
"@mandujs/core": patch
---

Align the DevTools ("Kitchen") design tokens with the mandujs.com brand. The panel now uses Mandu's signature warm palette instead of the previous cool-indigo theme: peach-orange accent `#FF8C66`, dark-brown surfaces (`#1F1B16`/`#2A2520`/`#3E3028`), warm cream text, the docs-grade semantic colors (info `#4A90C2`, success `#6B9E47`, warn `#E8A93A`, danger `#C85450`), warm-tinted shadows, and the Pretendard/Consolas font stacks — all taken from mandujs.com's `app/globals.css` and `styles/tokens.css`. Values only; component structure is unchanged (every component reads the tokens via CSS variables).
