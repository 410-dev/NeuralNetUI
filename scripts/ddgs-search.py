import json
import sys

from ddgs import DDGS


def read_request() -> dict:
    return json.loads(sys.stdin.buffer.read().decode("utf-8"))


def write_response(value: dict) -> None:
    payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def main() -> None:
    request = read_request()
    query = str(request.get("query", "")).strip()[:300]
    max_results = max(1, min(10, int(request.get("max_results", 5))))
    if not query:
        raise ValueError("Search query is empty.")
    raw_results = DDGS(timeout=15).text(query, max_results=max_results)
    results = [{"title": item.get("title", ""), "url": item.get("href", ""), "snippet": item.get("body", "")[:1600]} for item in raw_results]
    write_response({"query": query, "results": results})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        write_response({"error": str(error)})
        sys.exit(1)
