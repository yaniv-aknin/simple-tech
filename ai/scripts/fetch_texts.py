"""Download the Project Gutenberg books into raw/ and write cleaned versions to texts/.

Run with: uv run scripts/fetch_texts.py
"""
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent.parent
RAW = ROOT / "raw"
TEXTS = ROOT / "texts"

NOVELS = {
    "pride": (1342, "It is a truth universally"),
    "holmes": (1661, "To Sherlock Holmes she is always"),
    "dracula": (345, "3 May. Bistritz"),
    "moby": (2701, "Call me Ishmael"),
}
SHAKESPEARE_ID = 100
DICKENS = {
    "pickwick-papers": 580, "oliver-twist": 730, "nicholas-nickleby": 967, "old-curiosity-shop": 700,
    "barnaby-rudge": 917, "martin-chuzzlewit": 968, "dombey-and-son": 821, "david-copperfield": 766,
    "bleak-house": 1023, "hard-times": 786, "little-dorrit": 963, "tale-of-two-cities": 98,
    "great-expectations": 1400, "our-mutual-friend": 883, "edwin-drood": 564, "christmas-carol": 46,
}
PLAYS = ["HAMLET", "MACBETH", "KING LEAR", "OTHELLO", "ROMEO AND JULIET", "MIDSUMMER", "TEMPEST",
         "JULIUS CAESAR", "MERCHANT OF VENICE", "MUCH ADO", "TWELFTH NIGHT", "AS YOU LIKE IT"]

HEADING = re.compile(r"^(chapter\b.*|[IVXL]+\.?|[IVXL]+\. [A-Z ,'’\-]+|THE END|Contents|ADVENTURE [IVXL]+.*)$", re.I)
ALL_CAPS = re.compile(r"^\s*[A-Z0-9 .,'’:;\-]{4,70}$")


def download(name, book_id):
    path = RAW / f"{name}.txt"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}.txt"
        path.write_bytes(urllib.request.urlopen(url).read())
    text = path.read_text(encoding="utf-8").replace("\r", "")
    start = text.index("\n", text.index("*** START OF")) + 1
    return text[start:text.index("*** END OF")]


def tidy(text):
    text = re.sub(r"\[[^\]]*\]", "", text).replace("_", "")
    return re.sub(r"\n{2,}", "\n\n", text).strip() + "\n"


def clean_novel(text, first_line):
    text = text[text.index(first_line):]
    text = re.sub(r"\[Illustration[^\]]*\]", "", text)
    text = text.split("CHISWICK PRESS")[0]
    lines = []
    for line in text.split("\n"):
        s = line.strip()
        if len(s) < 60 and HEADING.match(s):
            continue
        if s and s != "V.E." and ALL_CAPS.match(line) and sum(c.isalpha() for c in s) >= 4:
            continue
        lines.append(line)
    return tidy("\n".join(lines))


def clean_dickens(text):
    return tidy(re.sub(r"\[Illustration[^\]]*\]", "", text))


def clean_plays(text):
    lines = text.split("\n")
    titles = sorted(lines.index(l.strip()) for l in lines[:200] if l.startswith("    ") and l.strip().isupper() and l.strip() in lines)
    out = []
    for k, i in enumerate(titles):
        if not any(p in lines[i] for p in PLAYS):
            continue
        play = lines[i:titles[k + 1] if k + 1 < len(titles) else len(lines)]
        dramatis = next(j for j, l in enumerate(play) if "Dramatis" in l)
        act1 = next(j for j in range(dramatis, len(play)) if play[j].strip() in ("ACT I", "ACT I."))
        for line in play[act1:]:
            s = line.strip()
            if re.match(r"^(ACT|SCENE|Scene|EPILOGUE|PROLOGUE|Enter|Exit)\b", s) and len(s) < 80:
                continue
            if line.startswith(" ") or (s and s != "I" and re.match(r"^[A-Z][A-Z0-9 .,'’&\-]*\.?$", s)):
                continue
            out.append(line)
    return tidy("\n".join(out))


if __name__ == "__main__":
    TEXTS.mkdir(exist_ok=True)
    for name, (book_id, first_line) in NOVELS.items():
        (TEXTS / f"{name}.txt").write_text(clean_novel(download(name, book_id), first_line), encoding="utf-8")
    (TEXTS / "shakespeare.txt").write_text(clean_plays(download("shakespeare", SHAKESPEARE_ID)), encoding="utf-8")
    (TEXTS / "dickens").mkdir(exist_ok=True)
    for name, book_id in DICKENS.items():
        (TEXTS / "dickens" / f"{name}.txt").write_text(clean_dickens(download(f"dickens/{name}", book_id)), encoding="utf-8")
