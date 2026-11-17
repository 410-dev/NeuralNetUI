FROM python:3.13-slim

# YouTube changes often; rebuild with a newer yt-dlp when subtitles stop loading:
#   docker compose build --build-arg YT_DLP_VERSION=<version>
ARG YT_DLP_VERSION=2026.10.26

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    YOUTUBE_SUBTITLE_CONFIG=/config/config.json

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt "yt-dlp==${YT_DLP_VERSION}"
COPY server.py subtitles.py ./
RUN mkdir -p /config && chmod 777 /config

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import json,os,urllib.request; p=os.environ['YOUTUBE_SUBTITLE_CONFIG']; port=json.load(open(p)).get('port',8080) if os.path.exists(p) else 8080; urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=3)"

CMD ["python", "server.py"]
