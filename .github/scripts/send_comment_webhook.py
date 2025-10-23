#!/usr/bin/env python3
"""Dispatch issue comment metadata to the DV webhook."""

from __future__ import annotations

import json
import os
import sys
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
        print(f"{name} is required but not set; skipping webhook dispatch.", file=sys.stderr)
        sys.exit(1)
    return value


def build_payload() -> dict[str, object]:
    payload = {
        "type": "general",
        "issueNumber": _int_or_none(_env_or_none("ISSUE_NUMBER")),
        "issueAuthorId": _int_or_none(_env_or_none("ISSUE_AUTHOR_ID")),
        "commentId": _int_or_none(_env_or_none("COMMENT_ID")),
        "commentBody": _env_or_none("COMMENT_BODY"),
        "commentUserId": _int_or_none(_env_or_none("COMMENT_USER_ID")),
        "commentUrl": _env_or_none("COMMENT_URL"),
        "commentCreatedAt": _env_or_none("COMMENT_CREATED_AT"),
    }
    return {key: value for key, value in payload.items() if value is not None}


def send_webhook() -> None:
    webhook_url = _require("DV_WEBHOOK_URL")
    webhook_secret = _require("DV_WEBHOOK_SECRET")

    payload = build_payload()
    if not payload:
        print("No payload data available; skipping webhook dispatch.", file=sys.stderr)
        sys.exit(1)

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
