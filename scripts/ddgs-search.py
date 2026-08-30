import json
import sys

from ddgs import DDGS


def main() -> None:
    request = json.load(sys.stdin)
    query = str(request.get("query", "")).strip()[:300]
    max_results = max(1, min(10, int(request.get("max_results", 5))))
    if not query:
        raise ValueError("Search query is empty.")
    raw_results = DDGS(timeout=15).text(query, max_results=max_results)
    results = [{"title": item.get("title", ""), "url": item.get("href", ""), "snippet": item.get("body", "")[:1600]} for item in raw_results]
    json.dump({"query": query, "results": results}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        json.dump({"error": str(error)}, sys.stdout, ensure_ascii=False)
        sys.exit(1)
