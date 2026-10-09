"""Author six literary excerpts from inspected, pinned Wikisource snapshots.

Download and HTML paragraph extraction are an explicit preparation step; the
reviewed source snapshots are kept under runs/, never distributed as full books.
"""
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from runpy import run_path
from urllib.parse import quote

from evaluation.suite import ROOT, dump, sha

helpers = run_path(str(ROOT / "scripts/build-evaluation-suite.py"))
n, s, t, actor = (helpers[key] for key in ("n", "s", "t", "actor"))
DIRECTORY = ROOT / "evaluations/literary-v1"
SNAPSHOTS = ROOT / "runs/quotation-evidence/sources"


def divided(text, selections):
    """Independently selected exact expressions; require ordered, unique source matches."""
    units, cursor = [], 0
    for literal, kind, who in selections:
        start = text.index(literal, cursor)
        if text[cursor:start]:
            units.append(n(text[cursor:start]))
        units.append((literal, kind, who))
        cursor = start + len(literal)
    if text[cursor:]:
        units.append(n(text[cursor:]))
    return units


def main():
    if DIRECTORY.exists():
        raise ValueError("literary_suite_exists_no_overwrite")
    paragraphs = {title: json.loads((SNAPSHOTS / f"{title}.json").read_text(encoding="utf-8"))
                  for title in ("孔乙己", "狂人日記", "故鄉")}
    # Select and annotate before any model calls. Attribution never supplies a
    # fictitious person just because a quote contains first-person pronouns.
    kong = paragraphs["孔乙己"][6]
    kong = kong[kong.index("孔乙己自己知道"):kong.index("不再理會。") + len("不再理會。")]
    mad = paragraphs["狂人日記"][23]
    mad = mad[:mad.index("我說：『可以！』") + len("我說：『可以！』")]
    home = "\n\n".join(paragraphs["故鄉"][6:10])
    birds = "\n\n".join(paragraphs["故鄉"][16:19])
    scenes = [
        ("kong-01", "孔乙己", kong, "thought", divided(kong, [
            ("『你讀過書麽？』", "speech", "kong"),
            ("『讀過書，……我便考你一考。茴香豆的茴字，怎樣寫的？』", "speech", "kong"),
            ("討飯一樣的人，也配考我麽？", "thought", "narrator")]),
         [("kong", "孔乙己", []), ("narrator", "我", [])],
         "孔乙己及他明确共指；我想直接引出内心内容。孩子/他们未限定具体个体，不创建虚构的单个儿童。"),
        ("kong-02", "孔乙己", paragraphs["孔乙己"][7], "continuation", divided(paragraphs["孔乙己"][7], [
            ("『不多了，我已經不多了。』", "speech", "kong"),
            ("『不多不多！多乎哉？不多也。』", "speech", "kong")]),
         [("kong", "孔乙己", [])], "两次发言都有同一人物的动作及说话提示。群体孩子没有可区分的个体身份。"),
        ("mad-01", "狂人日記", paragraphs["狂人日記"][11], "anonymous", divided(paragraphs["狂人日記"][11], [
            ("『老子呀！我要咬你幾口纔出氣！』", "speech", "woman")]),
         [("woman", "那個女人", ["女人"]), ("son", "兒子", []), ("narrator", "我", []), ("chen", "陳老五", [])],
         "女人打她儿子并说话，狂人的联想不改变明确发言主语；老子是台词自称语气，不创建另一父亲。"),
        ("mad-02", "狂人日記", mad, "pronoun", divided(mad, [
            ("『今天你彷佛很好。』", "speech", "brother"), ("『是的。』", "speech", "narrator"),
            ("『今天請何先生來，給你診一診。』", "speech", "brother"), ("『可以！』", "speech", "narrator")]),
         [("narrator", "我", []), ("brother", "大哥", ["我大哥"]), ("doctor", "何先生", ["老頭子"] )],
         "各句均有我说或大哥说，不按轮次猜测；被带来的唯一老头子与今天请来的何先生共指，不能据狂人推断另建刽子手。"),
        ("home-01", "故鄉", home, "explicit", divided(home, [
            ("『你休息一兩天，去拜望親戚本家一回，我們便可以走了。』", "speech", "mother")]),
         [("narrator", "我", []), ("mother", "母親", ["我的母親"]), ("hong", "宏兒", ["姪兒宏兒"])],
         "后置母亲说明确归属；前面我说与母亲也说为叙述转述。亲戚本家未提供可区分单个人物。"),
        ("home-02", "故鄉", birds, "pronoun", divided(birds, [(paragraphs["故鄉"][18], "speech", "run")]),
         [("narrator", "我", []), ("run", "閏土", [])],
         "閏土紧邻前文的他说明捕鸟，明确两人场景；台词我们指其生活群体，无具体他人锚点。")
    ]
    samples = []
    for name, title, text, category, units, actors, reason in scenes:
        assert "".join(u[0] for u in units) == text
        directory = DIRECTORY / name
        directory.mkdir(parents=True)
        source = text.encode("utf-8")
        (directory / "chapter.txt").write_bytes(source)
        segments, offset = [], 0
        for index, (literal, kind, who) in enumerate(units):
            end = offset + len(literal.encode("utf-8"))
            segment = {"id": f"seg-{index+1:03}", "start": offset, "end": end, "kind": kind}
            if who:
                segment["attribution"] = {"status": "resolved", "character_id": who, "review_status": "unreviewed",
                                          "evidence_segment_ids": [f"seg-{i+1:03}" for i, u in enumerate(units) if u[1] == "narration"]}
            segments.append(segment)
            offset = end
        characters, identities = [], []
        for identity, label, aliases in actors:
            # Locate identity mentions only in narration, not in another person's
            # first-person speech. Full descriptive labels outrank substrings.
            mentions = []
            for index, (literal, kind, _) in enumerate(units):
                if kind != "narration":
                    continue
                for word in [label, *aliases]:
                    for match in re.finditer(re.escape(word), literal):
                        start = segments[index]["start"] + len(literal[:match.start()].encode("utf-8"))
                        mention = {"start": start, "end": start + len(word.encode("utf-8")), "text": word}
                        if mention not in mentions:
                            mentions.append(mention)
            assert mentions, (name, identity)
            evidence = [{"chapter_id": "ch-001", "segment_id": seg["id"]} for seg in segments
                        if any(seg["start"] <= m["start"] < m["end"] <= seg["end"] for m in mentions)]
            characters.append({"id": identity, "display_name": label, "aliases": aliases, "review_status": "unreviewed", "evidence": evidence})
            identities.append({"character_id": identity, "allowed_labels": [label, *aliases], "mentions": mentions, "reason": reason})
        full_source = "\n\n".join(paragraphs[title]).encode("utf-8")
        start = full_source.index(source)
        html = (SNAPSHOTS / f"{title}.html").read_text(encoding="utf-8")
        revision = re.findall(r"oldid=(\d+)", html)[-1]
        provenance = {"title": title, "author": "魯迅", "url": f"https://zh.wikisource.org/w/index.php?title={quote(title)}&oldid={revision}",
                      "page_url": f"https://zh.wikisource.org/wiki/{quote(title)}", "revision": revision,
                      "retrieved_at": datetime.now(timezone.utc).isoformat(), "source_sha256": sha(full_source),
                      "excerpt_sha256": sha(source), "excerpt_start": start, "excerpt_end": start + len(source),
                      "extraction": "HTMLParser: mw-parser-output p text; strip paragraph edges, remove U+200B, join paragraphs with LF LF; retain original glyphs",
                      "license": "Public-domain work (Wikisource PD-old-80-1996); site editorial text CC BY-SA 4.0; source attribution retained"}
        dump(directory / "provenance.json", provenance)
        dump(directory / "characters.json", {"format_version": 1, "book_id": name, "revision": 1, "characters": characters})
        dump(directory / "chapter.annotations.json", {"format_version": 1, "book_id": name, "chapter_id": "ch-001", "character_revision": 1,
             "source": {"sha256": sha(source), "import_sha256": sha(source), "normalization_version": 1, "offset_unit": "utf8_byte"}, "segments": segments})
        dump(directory / "evaluation.json", {"evaluation_version": "literary-v1", "sample": name, "category": category,
                                             "split": "supplemental", "identities": identities, "rationale": reason})
        samples.append({"id": name, "category": category, "split": "supplemental"})
    dump(DIRECTORY / "suite.json", {"version": "literary-v1", "kind": "literary", "policy": "docs/annotation-policy.md", "samples": samples})


if __name__ == "__main__":
    main()
