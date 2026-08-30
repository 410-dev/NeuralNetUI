package com.neuralchat.nativeapp;

import java.util.ArrayList;
import java.util.List;

final class ChatModels {
    private ChatModels() {}

    static final class Message {
        final String role;
        String content;
        String reasoning;

        Message(String role, String content) {
            this(role, content, "");
        }

        Message(String role, String content, String reasoning) {
            this.role = role;
            this.content = content == null ? "" : content;
            this.reasoning = reasoning == null ? "" : reasoning;
        }
    }

    static final class Model {
        final String id;
        String name;
        String description;

        Model(String id, String name, String description) {
            this.id = id;
            this.name = name;
            this.description = description;
        }
    }

    static final class Conversation {
        String title;
        final List<Message> messages = new ArrayList<>();

        Conversation(String title) {
            this.title = title;
        }
    }
}
