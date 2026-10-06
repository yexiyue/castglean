"""Author attribution-v1 once. Refuses to overwrite a frozen suite."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUITE = ROOT / "evaluations/attribution-v1"


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def n(text):
    return (text, "narration", None)


def s(text, who):
    return (text, "speech", who)


def t(text, who):
    return (text, "thought", who)


def q(text):
    return (text, "quoted_text", None)


def actor(identity, label, anchors, aliases=()):
    return (identity, label, list(aliases), anchors)


# Each category: two development narratives followed by two structurally
# different holdout narratives. Anchors are explicit (unit index, substring).
SCENES = {
    "explicit": [
        ([n("苏禾说："), s("“窗子关上吧。”", "su")], [actor("su", "苏禾", [(0, "苏禾")])], "提示语直接指定苏禾发言。"),
        ([n("魏川回答："), s("“我带了地图。”", "wei"), n("秦夏问："), s("“哪条路最短？”", "qin")], [actor("wei", "魏川", [(0, "魏川")]), actor("qin", "秦夏", [(2, "秦夏")])], "问答均有独立明确提示语。"),
        ([s("“等我回来。”", "yan"), n("严秋对守门人说。")], [actor("yan", "严秋", [(1, "严秋")]), actor("guard", "守门人", [(1, "守门人")])], "后置提示语唯一指定发言者，听者不等于说者。"),
        ([n("信号灯灭了。"), s("“停船！”", "tao"), n("这是陶宁发出的命令。")], [actor("tao", "陶宁", [(2, "陶宁")])], "回指说明明确将命令归于陶宁。"),
    ],
    "pronoun": [
        ([n("赵青是房间里唯一的女人。她说："), s("“请坐。”", "zhao")], [actor("zhao", "赵青", [(0, "赵青"), (0, "她")])], "唯一女性身份使她可靠共指。"),
        ([n("小斌独自在门口。他低声说："), s("“钥匙找到了。”", "bin")], [actor("bin", "小斌", [(0, "小斌"), (0, "他")])], "独处且明确代词承接，唯一人物。"),
        ([n("送信人把信递给许遥。后者说："), s("“谢谢。”", "xu")], [actor("messenger", "送信人", [(0, "送信人")]), actor("xu", "许遥", [(0, "许遥"), (0, "后者")])], "后者指双项结构中的许遥，不靠距离猜测。"),
        ([n("杨朔和姐姐杨晴站在灯下。哥哥不在这里。作为两人中唯一的男性，他说："), s("“灯坏了。”", "yang")], [actor("yang", "杨朔", [(0, "杨朔"), (0, "他")]), actor("qing", "杨晴", [(0, "杨晴")]), actor("brother", "哥哥", [(0, "哥哥")])], "性别限定在灯下两人中唯一指向杨朔，另有不在场哥哥。"),
    ],
    "continuation": [
        ([n("陆棠说："), s("“第一箱留下。”", "lu"), n("她没有停下，接着说："), s("“第二箱搬走。”", "lu")], [actor("lu", "陆棠", [(0, "陆棠"), (2, "她")])], "明确没有停下并继续发言。"),
        ([n("程岩开始介绍："), s("“这里是仓库。”", "cheng"), n("他仍在讲话："), s("“楼上是宿舍。”", "cheng")], [actor("cheng", "程岩", [(0, "程岩"), (2, "他")])], "提示语明确持续同一发言。"),
        ([n("导游举起旗子，开始一段连续讲解，中途没有换人："), s("“左边是码头。”", "guide"), n("风吹动旗子，讲解继续："), s("“右边是车站。”", "guide")], [actor("guide", "导游", [(0, "导游")])], "叙述明确连续讲解无换人，不凭对白轮次。"),
        ([n("广播员对着话筒念出以下两句，全程由她一人播报："), s("“末班车已到站。请依次上车。”", "announcer")], [actor("announcer", "广播员", [(0, "广播员"), (0, "她")])], "多句表达唯一播报者。"),
    ],
    "candidates": [
        ([n("值班室只有蒋文和罗岳。记录明确写着：接下来的话出自两人之一，但无法分辨是谁。"), s("“轮到你了。”", ["jiang", "luo"])], [actor("jiang", "蒋文", [(0, "蒋文")]), actor("luo", "罗岳", [(0, "罗岳")])], "原文明示两人之一，完整有限候选。"),
        ([n("岑舟和宋雨各拿一只话筒。录音确认下面这句话由其中一人说出，无法区分："), s("“检查完毕。”", ["cen", "song"])], [actor("cen", "岑舟", [(0, "岑舟")]), actor("song", "宋雨", [(0, "宋雨")])], "录音明确来源只在两人中。"),
        ([s("“箱子空了。”", ["ma", "ning", "tong"]), n("笔录说明这句话只能来自马松、宁溪或童真之一，未记录具体是谁。")], [actor("ma", "马松", [(1, "马松")]), actor("ning", "宁溪", [(1, "宁溪")]), actor("tong", "童真", [(1, "童真")])], "后置笔录限定三个具体候选，不能遗漏。"),
        ([n("镜头中有戴帽子的工人和穿围裙的厨师。字幕注明下句话由这两人之一发出，声音无法分开："), s("“这边需要帮忙。”", ["worker", "cook"])], [actor("worker", "戴帽子的工人", [(0, "戴帽子的工人")]), actor("cook", "穿围裙的厨师", [(0, "穿围裙的厨师")])], "匿名身份具体且有限，不能随意确定。"),
    ],
    "unowned": [
        ([n("楼外传来一声喊，来源不明："), s("“快开门！”", "unknown")], [], "没有人物锚点或具体来源范围，仍是对白。"),
        ([n("沈默正在修表，忽然远处响起人声，无法知道来自谁："), s("“船来了！”", "unknown")], [actor("shen", "沈默", [(0, "沈默")])], "在场姓名不能替远方未知声音确定归属。"),
        ([s("“有人吗？”", "unknown"), n("这声呼喊从浓雾里传来，听不出是谁，也看不见人。")], [], "后置叙述没有可追踪身份。"),
        ([n("韩梅和石桥在屋里。窗外的人声来源完全不明，并不能限定为他们："), s("“桥塌了！”", "unknown")], [actor("han", "韩梅", [(0, "韩梅")]), actor("shi", "石桥", [(0, "石桥")])], "不得用在场名单构造有限候选。"),
    ],
    "anonymous": [
        ([n("柜台后只有一名店员。店员说："), s("“零钱收好。”", "clerk"), n("同一名店员又说："), s("“欢迎再来。”", "clerk")], [actor("clerk", "店员", [(0, "店员"), (2, "店员")])], "唯一柜台店员是可追踪身份，连续使用同一身份。"),
        ([n("红衣旅客举手说："), s("“我下站就走。”", "traveler"), n("红衣旅客放下手，补充道："), s("“请提醒我。”", "traveler")], [actor("traveler", "红衣旅客", [(0, "红衣旅客"), (2, "红衣旅客")])], "明确描述人物多次提及，不创建两个占位。"),
        ([s("“雨停了。”", "porter"), n("挑担的老人说。老人随后指着天说："), s("“可以赶路了。”", "porter")], [actor("porter", "挑担的老人", [(1, "挑担的老人"), (1, "老人")], ["老人"])], "后置描写与后续老人明确同指一个匿名身份。"),
        ([n("队伍中唯一戴绿帽的男孩接过水。他对递水的女孩说："), s("“谢谢你。”", "boy"), n("女孩回应："), s("“别客气。”", "girl")], [actor("boy", "戴绿帽的男孩", [(0, "戴绿帽的男孩"), (0, "他")]), actor("girl", "女孩", [(0, "女孩"), (2, "女孩")])], "两名匿名人物有明确锚点和指代。"),
    ],
    "same_name": [
        ([n("左边的老梁说："), s("“我修船。”", "left"), n("右边的老梁说："), s("“我织网。”", "right")], [actor("left", "老梁", [(0, "左边的老梁")], ["左边的老梁"]), actor("right", "老梁", [(2, "右边的老梁")], ["右边的老梁"])], "姓名相同，方位分别锚定不同身份。"),
        ([n("老师周宁与学生周宁并非同一人。老师周宁说："), s("“交作业吧。”", "teacher"), n("学生周宁说："), s("“在这里。”", "student")], [actor("teacher", "周宁", [(0, "老师周宁")], ["老师周宁"]), actor("student", "周宁", [(0, "学生周宁"), (2, "学生周宁")], ["学生周宁"])], "身份职能和原文明示区分两个周宁。"),
        ([s("“进来。”", "elder"), n("年长的陈安说。年轻的陈安随后回答："), s("“来了。”", "younger")], [actor("elder", "陈安", [(1, "年长的陈安")], ["年长的陈安"]), actor("younger", "陈安", [(1, "年轻的陈安")], ["年轻的陈安"])], "年龄锚点和后置提示语区分同名者。"),
        ([n("名单上的两个人都叫小田，是两个不同的人。录音只确认这两个人中一人说了："), s("“门锁好了。”", ["tian1", "tian2"])], [actor("tian1", "小田", [(0, "两个人都叫小田")]), actor("tian2", "小田", [(0, "两个人都叫小田")])], "群体锚点保证两个真实同名身份，无法区别具体说者，应保留两候选及匹配多解。"),
    ],
    "alias": [
        ([n("许南的外号是阿南。阿南说："), s("“车在外面。”", "xu")], [actor("xu", "许南", [(0, "许南"), (0, "阿南")], ["阿南"])], "明确外号关系合并一身份。"),
        ([n("余苇又名余青。余青说："), s("“信带到了。”", "yu"), n("余苇接着说："), s("“没有拆封。”", "yu")], [actor("yu", "余苇", [(0, "余苇"), (0, "余青"), (2, "余苇")], ["余青"])], "又名证据支持不同称呼同一身份。"),
        ([s("“茶还热。”", "shen"), n("大家叫说这句话的沈柏为柏叔。柏叔随后说："), s("“慢慢喝。”", "shen")], [actor("shen", "沈柏", [(1, "沈柏"), (1, "柏叔")], ["柏叔"])], "后置明确称呼关系，而非凭相似字猜别名。"),
        ([n("驾驶员姓胡，一名队员称他胡师傅。胡师傅向一名乘客说："), s("“请系好安全带。”", "hu")], [actor("hu", "胡师傅", [(0, "驾驶员"), (0, "胡师傅")], ["驾驶员"]), actor("team", "队员", [(0, "队员")]), actor("passenger", "乘客", [(0, "乘客")])], "明确职业称呼关系，队员与乘客也是锚定人物；各为一人。"),
    ],
    "thought": [
        ([n("顾晨心想："), t("“这条路太远。”", "gu")], [actor("gu", "顾晨", [(0, "顾晨")])], "心想明确内部语言。"),
        ([n("宋澜没有开口，只在心里对自己说："), t("“再试一次。”", "song")], [actor("song", "宋澜", [(0, "宋澜"), (0, "自己")])], "明确未说出且内心自语。"),
        ([t("“不能让他知道。”", "lin"), n("这个念头闪过林晖心头。这里的他指站在门口的钟远。")], [actor("lin", "林晖", [(1, "林晖")]), actor("zhong", "钟远", [(1, "钟远")])], "后置心理提示语指定思想者，思想内容他不等于思想者。"),
        ([n("何陶暗自想："), t("“终于到了。”", "he"), n("随后他说出口的是："), s("“请停一下。”", "he")], [actor("he", "何陶", [(0, "何陶"), (2, "他")])], "同一人物思想与外部发言分别标类型。"),
    ],
    "quoted": [
        ([n("书架上放着一本名为"), q("《归港》"), n("的书，没有人说话。")], [], "书名不是人物或对白。"),
        ([n("门上写着"), q("“请勿打扰”"), n("四个字，屋里没有人。")], [], "牌面文本不是发言者。"),
        ([n("任冬打开纸条，上面只有"), q("“明日见”"), n("三个字；任冬并未念出声。")], [actor("ren", "任冬", [(0, "任冬"), (2, "任冬")])], "明确未念出，纸条引文不附人物归属。"),
        ([n("梅清把字典里"), q("“潮汐”"), n("这个词圈了起来，随后说："), s("“我查到了。”", "mei")], [actor("mei", "梅清", [(0, "梅清")])], "术语引文和随后实际发言分开。"),
    ],
}


def main():
    if (SUITE / "freeze.json").exists():
        raise SystemExit("Frozen suite exists; changes require a new suite version")
    SUITE.mkdir(parents=True, exist_ok=True)
    samples = []
    for category, scenes in SCENES.items():
        for number, (units, actors, reason) in enumerate(scenes, 1):
            name = f"{category}-{number:02}"
            directory = SUITE / name
            directory.mkdir(exist_ok=True)
            source = "".join(unit[0] for unit in units).encode("utf-8")
            (directory / "chapter.txt").write_bytes(source)
            digest = hashlib.sha256(source).hexdigest()
            segments, offset = [], 0
            for index, (text, kind, who) in enumerate(units):
                end = offset + len(text.encode("utf-8"))
                segment = {"id": f"seg-{index + 1:03}", "start": offset, "end": end, "kind": kind}
                if who is not None:
                    attr = {"status": "ambiguous" if isinstance(who, list) else "unknown" if who == "unknown" else "resolved",
                            "evidence_segment_ids": [f"seg-{i + 1:03}" for i, u in enumerate(units) if u[1] == "narration"],
                            "review_status": "unreviewed"}
                    if isinstance(who, list):
                        attr["candidate_ids"] = who
                    elif who != "unknown":
                        attr["character_id"] = who
                    segment["attribution"] = attr
                segments.append(segment)
                offset = end
            characters, identities = [], []
            for identity, label, aliases, anchors in actors:
                mentions = []
                for index, substring in anchors:
                    pos = units[index][0].index(substring)
                    start = segments[index]["start"] + len(units[index][0][:pos].encode("utf-8"))
                    mentions.append({"start": start, "end": start + len(substring.encode("utf-8")), "text": substring})
                characters.append({"id": identity, "display_name": label, "aliases": aliases, "review_status": "unreviewed",
                                   "evidence": [{"chapter_id": "ch-001", "segment_id": f"seg-{i + 1:03}"} for i in sorted({i for i, _ in anchors})]})
                identities.append({"character_id": identity, "allowed_labels": [label, *aliases], "mentions": mentions, "reason": reason})
            write(directory / "characters.json", {"format_version": 1, "book_id": name, "revision": 1, "characters": characters})
            write(directory / "chapter.annotations.json", {"format_version": 1, "book_id": name, "chapter_id": "ch-001", "character_revision": 1,
                  "source": {"sha256": digest, "import_sha256": digest, "normalization_version": 1, "offset_unit": "utf8_byte"}, "segments": segments})
            split = "development" if number <= 2 else "holdout"
            write(directory / "evaluation.json", {"evaluation_version": "attribution-v1", "sample": name, "category": category,
                  "split": split, "identities": identities, "rationale": reason})
            samples.append({"id": name, "category": category, "split": split})
    write(SUITE / "suite.json", {"version": "attribution-v1", "policy": "docs/annotation-policy.md", "samples": samples})


if __name__ == "__main__":
    main()
