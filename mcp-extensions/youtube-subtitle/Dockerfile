FROM python:3.13-slim

# YouTube changes often; rebuild with a newer yt-dlp when subtitles or downloads stop working:
#   docker compose build --build-arg YT_DLP_VERSION=<version>
ARG YT_DLP_VERSION=2026.10.26

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    YOUTUBE_SUBTITLE_CONFIG=/config/config.json

# ffmpeg merges the best video and audio streams into one file.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
# yt-dlp[default] brings yt-dlp-ejs; with deno (requirements.txt) YouTube's full format list is available.
RUN pip install --no-cache-dir -r requirements.txt "yt-dlp[default]==${YT_DLP_VERSION}"
COPY server.py subtitles.py downloads.py ./
RUN mkdir -p /config /downloads && chmod 777 /config /downloads

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import json,os,urllib.request; p=os.environ['YOUTUBE_SUBTITLE_CONFIG']; port=json.load(open(p)).get('port',8080) if os.path.exists(p) else 8080; urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=3)"

CMD ["python", "server.py"]
