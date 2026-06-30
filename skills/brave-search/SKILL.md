---
name: brave-search
description: Search the web using the Brave Search API. Use when you need to find current information, documentation, or answers from the web.
---

# Brave Search

Search the web using the Brave Search API.

## Usage

Run the bundled script that lives in this skill's directory, passing a query.
Resolve `search.sh` against this skill's directory (the folder containing this
SKILL.md) and call it with its absolute path:

```bash
bash <skill-dir>/search.sh "your search query"
```

You can also pass an optional count (default 5, max 20):

```bash
bash <skill-dir>/search.sh "your search query" 10
```

## Requirements

- The `BRAVE_API_KEY` environment variable must be set (the server process
  provides it). If it is missing the script exits with an error.
- `curl` and `python3` must be available on the host.

## When to use

- When the user asks to search the web
- When you need current information not in your training data
- When you need to look up documentation, APIs, or recent events

## Output

Returns the title, URL, and description for each web result.
