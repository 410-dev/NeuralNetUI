package com.neuralchat.nativeapp;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

final class OpenAiClient {
    private OpenAiClient() {}

    interface StreamListener {
        void onDelta(String content, String reasoning);
    }

    static ChatModels.Message chat(
            String baseUrl,
            String apiKey,
            String model,
            String reasoningEffort,
            List<ChatModels.Message> messages
    ) throws Exception {
        JSONObject body = new JSONObject();
        body.put("model", model);
        body.put("stream", false);
        if (!reasoningEffort.isEmpty() && !"none".equals(reasoningEffort)) {
            body.put("reasoning_effort", reasoningEffort);
        }

        JSONArray serialized = new JSONArray();
        for (ChatModels.Message message : messages) {
            JSONObject item = new JSONObject();
            item.put("role", message.role);
            item.put("content", message.content);
            serialized.put(item);
        }
        body.put("messages", serialized);

        HttpURLConnection connection = open(trimTrailingSlashes(baseUrl) + "/chat/completions", apiKey, "POST");
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(bytes);
        }

        JSONObject response = new JSONObject(readResponse(connection));
        JSONArray choices = response.optJSONArray("choices");
        if (choices == null || choices.length() == 0) {
            throw new IllegalStateException("The server returned no completion choices.");
        }
        JSONObject message = choices.getJSONObject(0).getJSONObject("message");
        String content = message.optString("content", "");
        String reasoning = message.optString("reasoning_content", message.optString("reasoning", ""));
        return new ChatModels.Message("assistant", content, reasoning);
    }

    static ChatModels.Message chatStream(
            String baseUrl,
            String apiKey,
            String model,
            String reasoningEffort,
            List<ChatModels.Message> messages,
            StreamListener listener
    ) throws Exception {
        JSONObject body = new JSONObject();
        body.put("model", model);
        body.put("stream", true);
        if (!reasoningEffort.isEmpty() && !"none".equals(reasoningEffort)) body.put("reasoning_effort", reasoningEffort);
        JSONArray serialized = new JSONArray();
        for (ChatModels.Message message : messages) {
            JSONObject item = new JSONObject();
            item.put("role", message.role);
            item.put("content", message.content);
            serialized.put(item);
        }
        body.put("messages", serialized);

        HttpURLConnection connection = open(trimTrailingSlashes(baseUrl) + "/chat/completions", apiKey, "POST");
        connection.setRequestProperty("Accept", "text/event-stream, application/json");
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }

        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        if (status < 200 || status >= 300) {
            String error = readStream(stream);
            connection.disconnect();
            throw new IllegalStateException(error.isEmpty() ? "HTTP " + status : error);
        }

        StringBuilder content = new StringBuilder();
        StringBuilder reasoning = new StringBuilder();
        StringBuilder plainJson = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.startsWith("data:")) {
                    if (!line.trim().isEmpty()) plainJson.append(line);
                    continue;
                }
                String payload = line.substring(5).trim();
                if (payload.isEmpty() || "[DONE]".equals(payload)) continue;
                try {
                    JSONObject event = new JSONObject(payload);
                    JSONArray choices = event.optJSONArray("choices");
                    if (choices == null || choices.length() == 0) continue;
                    JSONObject choice = choices.optJSONObject(0);
                    JSONObject delta = choice == null ? null : choice.optJSONObject("delta");
                    if (delta == null) continue;
                    String contentDelta = delta.optString("content", "");
                    String reasoningDelta = delta.optString("reasoning_content", delta.optString("reasoning", ""));
                    if (!contentDelta.isEmpty()) content.append(contentDelta);
                    if (!reasoningDelta.isEmpty()) reasoning.append(reasoningDelta);
                    if (!contentDelta.isEmpty() || !reasoningDelta.isEmpty()) listener.onDelta(content.toString(), reasoning.toString());
                } catch (Exception ignored) {
                    // Some compatible servers emit non-JSON keep-alive events.
                }
            }
        } finally {
            connection.disconnect();
        }

        if (content.length() == 0 && reasoning.length() == 0 && plainJson.length() > 0) {
            JSONObject response = new JSONObject(plainJson.toString());
            JSONArray choices = response.optJSONArray("choices");
            if (choices != null && choices.length() > 0) {
                JSONObject message = choices.getJSONObject(0).getJSONObject("message");
                content.append(message.optString("content", ""));
                reasoning.append(message.optString("reasoning_content", message.optString("reasoning", "")));
                listener.onDelta(content.toString(), reasoning.toString());
            }
        }
        return new ChatModels.Message("assistant", content.toString(), reasoning.toString());
    }

    static List<ChatModels.Model> models(String baseUrl, String apiKey) throws Exception {
        HttpURLConnection connection = open(trimTrailingSlashes(baseUrl) + "/models", apiKey, "GET");
        JSONObject response = new JSONObject(readResponse(connection));
        JSONArray data = response.optJSONArray("data");
        List<ChatModels.Model> result = new ArrayList<>();
        if (data != null) {
            for (int index = 0; index < data.length(); index++) {
                JSONObject raw = data.optJSONObject(index);
                if (raw == null) continue;
                String id = raw.optString("id", "");
                if (!id.isEmpty()) result.add(new ChatModels.Model(id, friendlyName(id), "OpenAI-compatible model"));
            }
        }
        return result;
    }

    private static HttpURLConnection open(String rawUrl, String apiKey, String method) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(rawUrl).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(120_000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        if (!apiKey.trim().isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + apiKey.trim());
        if ("POST".equals(method)) connection.setDoOutput(true);
        return connection;
    }

    private static String readResponse(HttpURLConnection connection) throws Exception {
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        StringBuilder body = new StringBuilder();
        if (stream != null) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
            }
        }
        connection.disconnect();
        if (status < 200 || status >= 300) {
            String message = body.length() == 0 ? "HTTP " + status : body.toString();
            throw new IllegalStateException(message);
        }
        return body.toString();
    }

    private static String readStream(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder body = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) body.append(line);
        }
        return body.toString();
    }

    static String friendlyName(String id) {
        String[] parts = id.replace('_', ' ').replace('-', ' ').trim().split("\\s+");
        StringBuilder name = new StringBuilder();
        for (String part : parts) {
            if (part.isEmpty()) continue;
            if (name.length() > 0) name.append(' ');
            name.append(Character.toUpperCase(part.charAt(0))).append(part.substring(1));
        }
        return name.length() == 0 ? id : name.toString();
    }

    private static String trimTrailingSlashes(String value) {
        return value == null ? "" : value.replaceAll("/+$", "");
    }
}
