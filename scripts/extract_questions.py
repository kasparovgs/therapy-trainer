"""Extract the supplied PDFs locally. Requires pypdf and pdfplumber.

The original PDFs stay outside the public repository. No OCR or answer generation.
"""

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

from pypdf import PdfReader


def clean(text):
    text = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "-", text)
    return re.sub(r"\s+", " ", text).strip()


def read_document(path):
    pdf = PdfReader(path)
    pages = [re.sub(r"^\s*\d+\s*\n", "", page.extract_text() or "") for page in pdf.pages]
    body, key = "\n".join(pages).split("Эталоны ответов", 1)
    pairs = re.findall(r"(\d{1,3})\s*[-−–]\s*,?\s*([а-я])", key)
    answers = {int(number): letter for number, letter in pairs}
    assert len(pairs) == len(answers) == 400, "Expected exactly 400 answer keys"
    starts = list(re.finditer(r"(?m)^[ \t]*(\d{1,3})\.[ \t]*", body))
    assert [int(m[1]) for m in starts] == list(range(1, 401)), "Question numbers are not 1–400"
    questions = []
    for index, start in enumerate(starts):
        number = int(start[1])
        block = body[start.end():starts[index + 1].start() if index + 1 < len(starts) else len(body)]
        choices = list(re.finditer(r"(?mi)^[ \t]*([а-яa])\)[ \t]*", block))
        assert 2 <= len(choices) <= 7, f"Unexpected option count in {number}"
        options = []
        for option_index, choice in enumerate(choices):
            label = choice[1].lower().replace("a", "а")
            value = clean(block[choice.end():choices[option_index + 1].start() if option_index + 1 < len(choices) else len(block)])
            assert value, f"Empty option in {number}"
            options.append({"label": label, "text": value})
        labels = [option["label"] for option in options]
        assert labels == list("абвгдеж"[:len(labels)]), f"Option order in {number}: {labels}"
        assert answers[number] in labels, f"Answer missing from options in {number}"
        question = clean(block[:choices[0].start()])
        assert question, f"Empty question {number}"
        questions.append({"id": number, "text": question, "options": options, "answer": answers[number]})
    return pdf, questions, answers


def verify_highlights(path, pdf, answers):
    import pdfplumber

    found = {}
    previous = 0
    with pdfplumber.open(path) as document:
        for index, page in enumerate(document.pages):
            annotations = pdf.pages[index].get("/Annots", [])
            if not annotations:
                continue
            anchors = []
            for word in page.extract_words():
                match = re.match(r"^(\d{1,3})\.", word["text"])
                if match and 65 < word["x0"] < 105:
                    anchors.append((word["top"], int(match[1])))
            anchors.sort()
            for ref in annotations:
                annotation = ref.get_object()
                assert annotation.get("/Subtype") == "/Highlight"
                x0, y0, x1, y1 = map(float, annotation["/Rect"])
                top = page.height - y1
                preceding = [number for y, number in anchors if y <= top + 4]
                number = preceding[-1] if preceding else previous
                text = page.crop((max(0, x0), max(0, top), min(page.width, x1), min(page.height, page.height - y0))).extract_text() or ""
                match = re.match(r"\s*([а-яa])\)", text.lower())
                assert match, f"Unreadable highlight in {number}"
                label = match[1].replace("a", "а")
                assert number not in found, f"Duplicate highlight in {number}"
                assert label == answers[number], f"Highlight disagrees with key in {number}"
                found[number] = label
            if anchors:
                previous = anchors[-1][1]
            page.close()
    assert set(found) == set(range(1, 401)), "Not all 400 highlights were verified"
    return len(found)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--marked", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("data/questions.json"))
    args = parser.parse_args()
    _, questions, answers = read_document(args.source)
    marked_pdf, marked_questions, marked_answers = read_document(args.marked)
    assert answers == marked_answers, "The two answer tables disagree"
    highlights = verify_highlights(args.marked, marked_pdf, answers)
    normalized = lambda text: re.sub(r"\s+", "", text.casefold()).replace("\uf02d", "−")
    differences = [a["id"] for a, b in zip(questions, marked_questions) if normalized(json.dumps(a, ensure_ascii=False)) != normalized(json.dumps(b, ensure_ascii=False))]
    encoded = json.dumps(questions, ensure_ascii=False, sort_keys=True).encode("utf-8")
    result = {
        "schemaVersion": 1,
        "version": hashlib.sha256(encoded).hexdigest()[:16],
        "title": "Поликлиническая терапия",
        "source": args.source.name,
        "validation": {"questions": 400, "verifiedHighlights": highlights, "differentQuestionText": differences},
        "questions": questions,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"questions": len(questions), "verifiedHighlights": highlights, "options": dict(Counter(len(q["options"]) for q in questions)), "textDifferences": differences, "bankVersion": result["version"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
