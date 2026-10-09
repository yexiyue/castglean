"""Retrieve pinned public-domain Wikisource texts into an ignored review directory."""
import argparse
import json
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote

SOURCES = {"孔乙己": "2605389", "狂人日記": "2605391", "故鄉": "2570945"}


class Paragraphs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.active = 0
        self.in_paragraph = False
        self.parts = []
        self.paragraphs = []

    def handle_starttag(self, tag, attrs):
        if tag == "div":
            self.depth += 1
            if any(key == "class" and "mw-parser-output" in value.split() for key, value in attrs):
                self.active = self.depth
        if self.active and tag == "p":
            self.in_paragraph = True
            self.parts = []
        if self.in_paragraph and tag == "br":
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "p" and self.in_paragraph:
            text = "".join(self.parts).strip()
            if text:
                self.paragraphs.append(text.replace("\u200b", ""))
            self.in_paragraph = False
        if tag == "div":
            if self.depth == self.active:
                self.active = 0
            self.depth -= 1

    def handle_data(self, data):
        if self.in_paragraph:
            self.parts.append(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("runs/quotation-evidence/sources"))
    args = parser.parse_args()
    if args.output.exists() and any(args.output.iterdir()):
        raise ValueError("source_directory_not_empty_no_overwrite")
    args.output.mkdir(parents=True, exist_ok=True)
    for title, revision in SOURCES.items():
        url = f"https://zh.wikisource.org/w/index.php?title={quote(title)}&oldid={revision}"
        request = urllib.request.Request(url, headers={"User-Agent": "CastGleanEvaluation/0.1 (public literary excerpts)"})
        with urllib.request.urlopen(request, timeout=45) as response:
            html = response.read().decode("utf-8")
        paragraphs = Paragraphs()
        paragraphs.feed(html)
        if not paragraphs.paragraphs or "公有領域" not in html:
            raise ValueError("unexpected_source_page")
        (args.output / f"{title}.html").write_text(html, encoding="utf-8", newline="\n")
        (args.output / f"{title}.json").write_text(json.dumps(paragraphs.paragraphs, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
        print(f"retrieved revision {revision}")


if __name__ == "__main__":
    main()
