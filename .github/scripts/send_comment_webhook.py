#!/usr/bin/env python3
"""Dispatch issue comment metadata to the DV webhook."""

from __future__ import annotations

import json
import os
import sys
import re
import urllib.error
import urllib.request
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[assignment]
else:
    dotenv_path = Path(__file__).with_name(".env")
    load_dotenv(dotenv_path=dotenv_path, override=False)


def _env_or_none(name: str) -> str | None:
    value = os.getenv(name)
    if value is None:
        return None
    value = value.strip()
    return value or None


def _int_or_none(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _require(name: str) -> str:
    value = _env_or_none(name)
    if value is None:
        print(
            f"{name} is required but not set; skipping webhook dispatch.",
            file=sys.stderr,
        )
        sys.exit(1)
    return value


def _extract_logfmt_field(logfmt: str | None, field: str) -> str | None:
    if not logfmt:
        return None
    pattern = r"\b" + re.escape(field) + r'="([^"]*)"'
    m = re.search(pattern, logfmt)
    if m:
        return m.group(1)
    return None


def build_payload() -> dict[str, object]:
    issue_title_raw = _env_or_none("ISSUE_TITLE")
    report_title = _extract_logfmt_field(issue_title_raw, "title")

    payload = {
        "type": "general",
        "issueNumber": _int_or_none(_env_or_none("ISSUE_NUMBER")),
        "issueAuthorId": _int_or_none(_env_or_none("ISSUE_AUTHOR_ID")),
        "commentId": _int_or_none(_env_or_none("COMMENT_ID")),
        "commentBody": _env_or_none("COMMENT_BODY"),
        "commentUserId": _int_or_none(_env_or_none("COMMENT_USER_ID")),
        "commentUrl": _env_or_none("COMMENT_URL"),
        "commentCreatedAt": _env_or_none("COMMENT_CREATED_AT"),
        "reportTitle": report_title,
    }
    return {key: value for key, value in payload.items() if value is not None}


def send_webhook() -> None:
    webhook_url = _require("DV_WEBHOOK_URL")
    webhook_secret = _require("DV_WEBHOOK_SECRET")

    payload = build_payload()
    if not payload:
        print("No payload data available; skipping webhook dispatch.", file=sys.stderr)
        sys.exit(1)

    # If the comment author is the same as the issue author, skip sending the webhook.
    # People do not need to be notified when they comment on their own report.
    comment_user_id = payload.get("commentUserId")
    issue_author_id = payload.get("issueAuthorId")
    if (
        comment_user_id is not None
        and issue_author_id is not None
        and comment_user_id == issue_author_id
    ):
        print(
            "Comment author is the same as the issue author; skipping webhook dispatch.",
            file=sys.stderr,
        )
        sys.exit(0)

    # If the comment body contains a command, skip sending the webhook.
    # This is to avoid notifying users about bot commands that do not directly affect them.
    comment_body = str(payload.get("commentBody") or "")
    ignored_substrings = [
        "/reportbot help",
        "/reportbot resolve",
        "/reportbot delete",
    ]
    if any(sub in comment_body for sub in ignored_substrings):
        print("Comment contains an ignored substring; skipping webhook dispatch.", file=sys.stderr)
        sys.exit(0)

    data = json.dumps(payload)
    print(json.dumps(payload, indent=1))

    request = urllib.request.Request(
        webhook_url,
        data=data.encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-github-workflow-secret": webhook_secret,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request) as response:
            response.read()
        print("Webhook dispatched successfully.")
    except urllib.error.HTTPError as error:
        print(f"Webhook HTTP error: {error.code} - {error.reason}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as error:
        print(f"Webhook request failed: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    send_webhook()
