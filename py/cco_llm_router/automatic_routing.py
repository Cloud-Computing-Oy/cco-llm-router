"""Deterministic task classification for automatic model routing."""

from __future__ import annotations

import re

HIGH_RISK = re.compile(
    r"\b(legal|law|contract|tax|accounting|medical|diagnos|investment|financial advice|security|credential|production|deploy|migration|delete|oikeud|laki|sopimu|vero|kirjanp|lääke|diagnoo|sijoitu|tietotur|tunnus|tuotanto|julkais|migraatio|poista)\w*",
    re.IGNORECASE,
)
REASONING = re.compile(
    r"\b(reason|analyse|analyze|evaluate|strategy|architecture|audit|investigate|root cause|plan|päättele|analysoi|arvioi|strategia|arkkitehtuuri|auditoi|tutki|juurisyy|suunnittele)\w*",
    re.IGNORECASE,
)
CODE = re.compile(
    r"\b(code|implement|function|class|typescript|python|sql|koodi|toteuta|funktio|luokka)\w*",
    re.IGNORECASE,
)


def select_automatic_alias(
    *,
    prompt: str,
    system: str = "",
    data_class: str = "internal",
    task_risk: str | None = None,
    task_kind: str | None = None,
) -> str:
    text = f"{system}\n{prompt}"
    if task_risk == "high" or HIGH_RISK.search(text):
        return "auto:reasoning"
    if task_kind == "reasoning":
        return "auto:reasoning"
    if task_kind == "large-context" or len(prompt) > 12_000:
        return "auto:big"
    if task_kind == "code" or CODE.search(text):
        return "auto:code"
    if data_class in {"confidential", "restricted"}:
        return "auto:smart"
    if task_risk == "standard" and REASONING.search(text):
        return "auto:reasoning"
    if REASONING.search(text):
        return "auto:smart"
    return "auto:laptop-assisted"
