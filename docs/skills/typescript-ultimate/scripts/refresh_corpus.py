#!/usr/bin/env python3
"""Refresh Type-related skill corpus from skills.sh search results.
Saves raw HTML + text extracts to research/typescript-skills.
"""

from html.parser import HTMLParser
from pathlib import Path
import re
import urllib.request

BASE = "https://skills.sh"
QUERY = f"{BASE}/?q=Type"
OUT = Path("research/typescript-skills")


class MainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_main = False
        self.skip = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "main":
            self.in_main = True
        if self.in_main and tag in ("script", "style", "noscript", "svg"):
            self.skip += 1
        if self.in_main and self.skip == 0 and tag in ("h1", "h2", "h3", "h4", "p", "li", "pre", "code", "br"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if self.in_main and tag in ("script", "style", "noscript", "svg") and self.skip > 0:
            self.skip -= 1
        if tag == "main":
            self.in_main = False

    def handle_data(self, data):
        if self.in_main and self.skip == 0:
            s = data.strip()
            if s:
                self.parts.append(s + " ")

    def text(self):
        txt = "".join(self.parts)
        return re.sub(r"\n{3,}", "\n\n", txt).strip()


def get(url: str) -> str:
    return urllib.request.urlopen(url, timeout=25).read().decode("utf-8", "ignore")


def extract_links(search_html: str):
    # Extract visible skill links from list items (/owner/repo/skill)
    links = sorted(set(re.findall(r'href="(/[^"#? ]+)"', search_html)))
    return [l for l in links if len([p for p in l.split('/') if p]) == 3]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "raw").mkdir(exist_ok=True)
    (OUT / "text").mkdir(exist_ok=True)

    html = get(QUERY)
    links = extract_links(html)

    index_lines = []
    for link in links:
        url = BASE + link
        slug = link.strip('/').replace('/', '__').replace(':', '-')
        try:
            page = get(url)
        except Exception:
            continue
        (OUT / "raw" / f"{slug}.html").write_text(page)

        p = MainText()
        p.feed(page)
        txt = p.text()
        if len(txt) < 200:
            txt = re.sub(r"<script[\s\S]*?</script>", " ", page)
            txt = re.sub(r"<style[\s\S]*?</style>", " ", txt)
            txt = re.sub(r"<[^>]+>", " ", txt)
            txt = re.sub(r"\s+", " ", txt).strip()

        (OUT / "text" / f"{slug}.txt").write_text(txt)
        index_lines.append(f"{link}\t{len(txt)}")

    (OUT / "index.tsv").write_text("\n".join(index_lines) + "\n")
    print(f"saved {len(index_lines)} skill pages")


if __name__ == "__main__":
    main()
