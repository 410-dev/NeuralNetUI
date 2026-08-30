package com.neuralchat.nativeapp;

import android.app.Activity;
import android.app.AlertDialog;
import android.animation.ValueAnimator;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsAnimation;
import android.view.WindowManager;
import android.view.animation.PathInterpolator;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int PICK_IMAGE = 42;

    final ArrayList<ChatModels.Model> models = new ArrayList<>();
    final ArrayList<ChatModels.Conversation> histories = new ArrayList<>();
    ChatModels.Conversation conversation;
    ChatModels.Model selectedModel;

    boolean drawerOpen;
    boolean modelMenuOpen;
    boolean presetMenuOpen;
    boolean settingsOpen;
    boolean searching;
    boolean generating;
    boolean onDemand;
    boolean korean = true;
    int settingsTab;
    String reasoningPreset = "None";
    String attachmentName = "";
    String statusMessage = "";
    String displayName;
    String baseUrl;
    String apiKey;

    private FrameLayout root;
    private NeuralChatView surface;
    private EditText composer;
    private SharedPreferences preferences;
    private final ExecutorService network = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.rgb(7, 9, 8));
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().setFlags(
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
            );
        }

        preferences = getSharedPreferences("neural-chat", MODE_PRIVATE);
        displayName = preferences.getString("display_name", "Song");
        baseUrl = preferences.getString("base_url", "http://10.0.2.2:8888/v1");
        apiKey = preferences.getString("api_key", "");
        korean = preferences.getBoolean("korean", true);
        onDemand = preferences.getBoolean("on_demand", false);

        String modelId = preferences.getString("model_id", "qwen3.8-27b");
        String modelName = preferences.getString("model_name", "Qwen3.8 27B");
        selectedModel = new ChatModels.Model(modelId, modelName, korean ? "OpenAI 호환 모델" : "OpenAI-compatible model");
        models.add(selectedModel);
        restoreHistoryTitles();

        root = new FrameLayout(this);
        surface = new NeuralChatView(this);
        composer = new EditText(this);
        configureComposer();
        root.addView(surface, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(composer, new FrameLayout.LayoutParams(1, 1));
        setContentView(root);

        root.setOnApplyWindowInsetsListener((view, insets) -> { applyInsets(insets); return insets; });
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            root.setWindowInsetsAnimationCallback(new WindowInsetsAnimation.Callback(WindowInsetsAnimation.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                @Override
                public WindowInsets onProgress(WindowInsets insets, List<WindowInsetsAnimation> runningAnimations) {
                    applyInsets(insets);
                    return insets;
                }
            });
        }
    }

    private void applyInsets(WindowInsets insets) {
        int top;
        int navigationBottom;
        int imeBottom = 0;
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            top = insets.getInsets(WindowInsets.Type.statusBars()).top;
            navigationBottom = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
            imeBottom = insets.getInsets(WindowInsets.Type.ime()).bottom;
        } else {
            top = insets.getSystemWindowInsetTop();
            navigationBottom = insets.getSystemWindowInsetBottom();
        }
        surface.setInsets(top, navigationBottom, imeBottom);
    }

    private void configureComposer() {
        composer.setBackgroundColor(Color.TRANSPARENT);
        composer.setTextColor(Color.rgb(241, 244, 242));
        composer.setHintTextColor(Color.rgb(121, 130, 125));
        composer.setTextSize(15);
        composer.setGravity(Gravity.TOP | Gravity.START);
        composer.setPadding(0, 0, 0, 0);
        composer.setMaxLines(4);
        composer.setSingleLine(false);
        composer.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        composer.setImeOptions(EditorInfo.IME_ACTION_SEND | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        composer.setHint(korean ? "모델에게 메시지 보내기…" : "Message your model…");
        composer.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                sendMessage();
                return true;
            }
            return false;
        });
        composer.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { surface.invalidate(); }
            @Override public void afterTextChanged(Editable s) {}
        });
    }

    void placeComposer(RectF bounds, boolean visible) {
        composer.setVisibility(visible ? View.VISIBLE : View.GONE);
        if (!visible) return;
        FrameLayout.LayoutParams current = (FrameLayout.LayoutParams) composer.getLayoutParams();
        int left = Math.round(bounds.left);
        int top = Math.round(bounds.top);
        int width = Math.max(1, Math.round(bounds.width()));
        int height = Math.max(1, Math.round(bounds.height()));
        if (current.leftMargin == left && current.topMargin == top && current.width == width && current.height == height) return;
        current.leftMargin = left;
        current.topMargin = top;
        current.width = width;
        current.height = height;
        composer.setLayoutParams(current);
    }

    void setDrawerOpen(boolean open) {
        drawerOpen = open;
        surface.animateDrawer(open);
    }

    void setModelMenuOpen(boolean open) {
        modelMenuOpen = open;
        surface.animateModelMenu(open);
    }

    void setPresetMenuOpen(boolean open) {
        presetMenuOpen = open;
        surface.animatePresetMenu(open);
    }

    void setSettingsOpen(boolean open) {
        settingsOpen = open;
        surface.animateSettings(open);
    }

    void newChat() {
        conversation = null;
        setDrawerOpen(false);
        setModelMenuOpen(false);
        statusMessage = "";
        attachmentName = "";
        composer.setText("");
        surface.invalidate();
    }

    void sendMessage() {
        if (generating) return;
        String text = composer.getText().toString().trim();
        if (text.isEmpty() && attachmentName.isEmpty()) return;
        if (conversation == null) {
            conversation = new ChatModels.Conversation(titleFrom(text.isEmpty() ? (korean ? "이미지 대화" : "Image chat") : text));
            histories.add(0, conversation);
        }
        ChatModels.Message userMessage = new ChatModels.Message("user", text.isEmpty() ? "📎 " + attachmentName : text);
        conversation.messages.add(userMessage);
        ArrayList<ChatModels.Message> request = new ArrayList<>(conversation.messages);
        int userIndex = conversation.messages.size() - 1;
        ChatModels.Message streamed = new ChatModels.Message("assistant", "", "");
        conversation.messages.add(streamed);
        composer.setText("");
        attachmentName = "";
        generating = true;
        statusMessage = "";
        hideKeyboard();
        persistHistoryTitles();
        surface.animateMessage(userIndex);
        runStreamingCompletion(request, streamed);
    }

    private void runStreamingCompletion(ArrayList<ChatModels.Message> request, ChatModels.Message streamed) {
        String requestUrl = baseUrl;
        String requestKey = apiKey;
        String requestModel = selectedModel.id;
        String effort = reasoningPreset.toLowerCase(Locale.ROOT);
        network.execute(() -> {
            try {
                ChatModels.Message result = OpenAiClient.chatStream(requestUrl, requestKey, requestModel, effort, request, (content, reasoning) -> runOnUiThread(() -> {
                    boolean firstDelta = streamed.content.isEmpty() && streamed.reasoning.isEmpty();
                    streamed.content = content;
                    streamed.reasoning = reasoning;
                    if (firstDelta && conversation != null) surface.animateMessage(conversation.messages.indexOf(streamed));
                    else surface.postInvalidateOnAnimation();
                }));
                runOnUiThread(() -> {
                    streamed.content = result.content;
                    streamed.reasoning = result.reasoning;
                    generating = false;
                    surface.postInvalidateOnAnimation();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    generating = false;
                    if (conversation != null && streamed.content.isEmpty() && streamed.reasoning.isEmpty()) conversation.messages.remove(streamed);
                    statusMessage = friendlyError(error);
                    surface.postInvalidateOnAnimation();
                });
            }
        });
    }

    void regenerateMessage(int index) {
        if (conversation == null || generating || index < 0 || index >= conversation.messages.size()) return;
        ChatModels.Message selected = conversation.messages.get(index);
        int requestEnd = "assistant".equals(selected.role) ? index : index + 1;
        while (conversation.messages.size() > requestEnd) conversation.messages.remove(conversation.messages.size() - 1);
        ArrayList<ChatModels.Message> request = new ArrayList<>(conversation.messages);
        ChatModels.Message streamed = new ChatModels.Message("assistant", "", "");
        conversation.messages.add(streamed);
        generating = true;
        statusMessage = "";
        surface.animateMessage(conversation.messages.size() - 1);
        runStreamingCompletion(request, streamed);
    }

    void showMessageActions(int index) {
        if (conversation == null || generating || index < 0 || index >= conversation.messages.size()) return;
        ChatModels.Message message = conversation.messages.get(index);
        boolean user = "user".equals(message.role);
        String[] actions = user
                ? new String[]{korean ? "이 메시지부터 재생성" : "Regenerate from here", korean ? "편집 후 분기" : "Edit and branch", korean ? "복사" : "Copy", korean ? "삭제" : "Delete"}
                : new String[]{korean ? "응답 재생성" : "Regenerate response", korean ? "응답 편집" : "Edit response", korean ? "복사" : "Copy"};
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(user ? (korean ? "내 메시지" : "Your message") : (korean ? "모델 응답" : "Model response"))
                .setItems(actions, (d, which) -> {
                    if (which == 0) regenerateMessage(index);
                    else if (which == 1) showFieldEditor(actions[1], message.content, false, value -> {
                        if (!value.isEmpty()) {
                            message.content = value;
                            if (user) regenerateMessage(index);
                            else surface.animateMessage(index);
                        }
                    });
                    else if (which == 2) {
                        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                        clipboard.setPrimaryClip(ClipData.newPlainText("Neural Chat message", message.content));
                        Toast.makeText(this, korean ? "복사했습니다." : "Copied.", Toast.LENGTH_SHORT).show();
                    } else if (user && which == 3) {
                        conversation.messages.remove(index);
                        surface.postInvalidateOnAnimation();
                    }
                })
                .setNegativeButton(korean ? "취소" : "Cancel", null)
                .create();
        dialog.show();
    }

    void discoverModels() {
        statusMessage = korean ? "모델을 찾는 중…" : "Detecting models…";
        surface.invalidate();
        network.execute(() -> {
            try {
                List<ChatModels.Model> discovered = OpenAiClient.models(baseUrl, apiKey);
                runOnUiThread(() -> {
                    if (!discovered.isEmpty()) {
                        models.clear();
                        models.addAll(discovered);
                        selectedModel = models.get(0);
                        statusMessage = korean ? models.size() + "개 모델을 찾았습니다." : models.size() + " models detected.";
                    } else {
                        statusMessage = korean ? "서버에서 모델을 찾지 못했습니다." : "No models were returned.";
                    }
                    surface.invalidate();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    statusMessage = friendlyError(error);
                    surface.invalidate();
                });
            }
        });
    }

    void saveSettings() {
        preferences.edit()
                .putString("display_name", displayName)
                .putString("base_url", baseUrl)
                .putString("api_key", apiKey)
                .putBoolean("korean", korean)
                .putBoolean("on_demand", onDemand)
                .putString("model_id", selectedModel.id)
                .putString("model_name", selectedModel.name)
                .apply();
        composer.setHint(korean ? "모델에게 메시지 보내기…" : "Message your model…");
        setSettingsOpen(false);
        statusMessage = "";
        surface.invalidate();
    }

    void showFieldEditor(String title, String value, boolean password, FieldReceiver receiver) {
        EditText field = new EditText(this);
        field.setText(value);
        field.setSelectAllOnFocus(true);
        field.setTextColor(Color.rgb(241, 244, 242));
        field.setHintTextColor(Color.rgb(111, 121, 115));
        field.setSingleLine(true);
        field.setInputType(password
                ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD
                : InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        int padding = Math.round(18 * getResources().getDisplayMetrics().density);
        FrameLayout box = new FrameLayout(this);
        box.setPadding(padding, 0, padding, 0);
        box.addView(field, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(title)
                .setView(box)
                .setNegativeButton(korean ? "취소" : "Cancel", null)
                .setPositiveButton(korean ? "확인" : "OK", (d, which) -> receiver.accept(field.getText().toString().trim()))
                .create();
        dialog.setOnShowListener(d -> {
            dialog.getWindow().setBackgroundDrawableResource(android.R.color.background_dark);
            field.requestFocus();
            dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        });
        dialog.show();
    }

    void pickImage() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        startActivityForResult(intent, PICK_IMAGE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_IMAGE && resultCode == RESULT_OK && data != null) {
            Uri uri = data.getData();
            attachmentName = uri == null ? "image" : uri.getLastPathSegment();
            surface.invalidate();
        }
    }

    @Override
    public void onBackPressed() {
        if (settingsOpen) setSettingsOpen(false);
        else if (drawerOpen) setDrawerOpen(false);
        else if (modelMenuOpen) setModelMenuOpen(false);
        else if (presetMenuOpen) setPresetMenuOpen(false);
        else {
            super.onBackPressed();
            return;
        }
        surface.invalidate();
    }

    @Override
    protected void onDestroy() {
        network.shutdownNow();
        super.onDestroy();
    }

    private String titleFrom(String text) {
        String normalized = text.replace('\n', ' ').trim();
        return normalized.length() > 38 ? normalized.substring(0, 38) + "…" : normalized;
    }

    private String friendlyError(Exception error) {
        String message = error.getMessage();
        if (message == null || message.isEmpty()) message = error.getClass().getSimpleName();
        if (message.length() > 180) message = message.substring(0, 180) + "…";
        return korean ? "서버 연결 오류: " + message : "Server error: " + message;
    }

    private void hideKeyboard() {
        composer.clearFocus();
        InputMethodManager keyboard = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        keyboard.hideSoftInputFromWindow(composer.getWindowToken(), 0);
    }

    private void persistHistoryTitles() {
        StringBuilder saved = new StringBuilder();
        for (ChatModels.Conversation item : histories) {
            if (saved.length() > 0) saved.append('\n');
            saved.append(item.title.replace('\n', ' '));
        }
        preferences.edit().putString("history_titles", saved.toString()).apply();
    }

    private void restoreHistoryTitles() {
        String saved = preferences.getString("history_titles", "");
        if (saved == null || saved.isEmpty()) {
            histories.add(new ChatModels.Conversation("오픈웨이트 LLM 을 사용할때 롤플레이를 하고 싶습니다."));
            histories.add(new ChatModels.Conversation("A patient who had depression was on"));
            histories.add(new ChatModels.Conversation("역사적으로 미스터리한 사건들에 대해 알려주세요"));
            histories.add(new ChatModels.Conversation("안녕하세요"));
            return;
        }
        for (String title : saved.split("\\n")) if (!title.isEmpty()) histories.add(new ChatModels.Conversation(title));
    }

    interface FieldReceiver { void accept(String value); }

    final class NeuralChatView extends View {
        private static final int BG = 0xFF070908;
        private static final int PANEL = 0xFF191D1B;
        private static final int PANEL_SOFT = 0xFF1D211F;
        private static final int PANEL_RAISED = 0xFF252A27;
        private static final int FIELD = 0xFF202522;
        private static final int TEXT = 0xFFF1F4F2;
        private static final int MUTED = 0xFF9CA6A0;
        private static final int DIM = 0xFF6F7973;
        private static final int ACCENT = 0xFF4E9A87;
        private static final int ACCENT_BRIGHT = 0xFF69B6A2;
        private static final int BORDER = 0x18EEF5F0;
        private static final int BORDER_STRONG = 0x29EEF5F0;

        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final TextPaint textPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        private final Path path = new Path();
        private final RectF composerCard = new RectF();
        private final RectF composerInput = new RectF();
        private final RectF menuButton = new RectF();
        private final RectF modelButton = new RectF();
        private final RectF sendButton = new RectF();
        private final RectF attachButton = new RectF();
        private final RectF presetButton = new RectF();
        private final RectF profileButton = new RectF();
        private final ArrayList<MessageHit> messageHits = new ArrayList<>();
        private final Handler gestureHandler = new Handler(Looper.getMainLooper());
        private final PathInterpolator smoothInterpolator = new PathInterpolator(.2f, .8f, .25f, 1f);
        private float density;
        private int topInset;
        private int bottomInset;
        private int navigationInset;
        private int imeInset;
        private float drawerProgress;
        private float modelMenuProgress;
        private float presetMenuProgress;
        private float settingsProgress;
        private float messageProgress = 1f;
        private int animatedMessageIndex = -1;
        private int pressedMessageIndex = -1;
        private float gestureDownX;
        private float gestureDownY;
        private boolean longPressTriggered;
        private Runnable longPressRunnable;
        private ValueAnimator drawerAnimator;
        private ValueAnimator modelAnimator;
        private ValueAnimator presetAnimator;
        private ValueAnimator settingsAnimator;
        private ValueAnimator messageAnimator;

        NeuralChatView(Activity context) {
            super(context);
            density = getResources().getDisplayMetrics().density;
            setLayerType(View.LAYER_TYPE_SOFTWARE, null);
            setFocusable(true);
            setContentDescription("Neural Chat native interface");
        }

        void setInsets(int top, int navigation, int ime) {
            topInset = top;
            navigationInset = navigation;
            imeInset = ime;
            bottomInset = Math.max(navigation, ime);
            postInvalidateOnAnimation();
        }

        void animateDrawer(boolean open) { drawerAnimator = animate(drawerAnimator, drawerProgress, open ? 1f : 0f, 240, value -> drawerProgress = value); }
        void animateModelMenu(boolean open) { modelAnimator = animate(modelAnimator, modelMenuProgress, open ? 1f : 0f, 180, value -> modelMenuProgress = value); }
        void animatePresetMenu(boolean open) { presetAnimator = animate(presetAnimator, presetMenuProgress, open ? 1f : 0f, 180, value -> presetMenuProgress = value); }
        void animateSettings(boolean open) { settingsAnimator = animate(settingsAnimator, settingsProgress, open ? 1f : 0f, 230, value -> settingsProgress = value); }
        void animateMessage(int index) {
            animatedMessageIndex = index;
            messageProgress = 0f;
            messageAnimator = animate(messageAnimator, 0f, 1f, 280, value -> messageProgress = value);
        }

        private ValueAnimator animate(ValueAnimator previous, float from, float to, long duration, FloatReceiver receiver) {
            if (previous != null) previous.cancel();
            ValueAnimator animator = ValueAnimator.ofFloat(from, to);
            animator.setDuration(duration);
            animator.setInterpolator(smoothInterpolator);
            animator.addUpdateListener(value -> { receiver.accept((float) value.getAnimatedValue()); postInvalidateOnAnimation(); });
            animator.start();
            return animator;
        }

        float d(float value) { return value * density; }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            drawBackground(canvas);
            drawMain(canvas);
            if (drawerProgress > .001f) drawDrawer(canvas);
            if (settingsProgress > .001f) {
                int layer = canvas.saveLayerAlpha(0, 0, getWidth(), getHeight(), Math.max(1, Math.round(settingsProgress * 255)));
                canvas.translate(0, d(12) * (1f - settingsProgress));
                drawSettings(canvas);
                canvas.restoreToCount(layer);
            }
            boolean inputVisible = drawerProgress < .01f && settingsProgress < .01f;
            post(() -> placeComposer(composerInput, inputVisible));
        }

        private void drawBackground(Canvas canvas) {
            canvas.drawColor(BG);
            float radius = Math.max(getWidth(), getHeight()) * .72f;
            paint.setShader(new RadialGradient(getWidth() * .52f, getHeight() * .57f, radius,
                    new int[]{0x84306452, 0x3D183E33, 0x00070908}, new float[]{0f, .31f, .72f}, Shader.TileMode.CLAMP));
            canvas.drawRect(0, 0, getWidth(), getHeight(), paint);
            paint.setShader(null);
        }

        private void drawMain(Canvas canvas) {
            float top = topInset + d(8);
            menuButton.set(d(16), top, d(52), top + d(36));
            fillRound(canvas, menuButton, d(11), 0xD91C211E);
            iconHamburger(canvas, menuButton.centerX(), menuButton.centerY(), d(9), MUTED);

            modelButton.set(d(62), top - d(1), Math.min(getWidth() - d(14), d(245)), top + d(40));
            text(canvas, selectedModel == null ? copy("모델 선택", "Select a model") : selectedModel.name,
                    modelButton.left + d(7), modelButton.centerY() + d(6), d(19), TEXT, false);
            iconChevron(canvas, Math.min(modelButton.right - d(9), modelButton.left + d(150)), modelButton.centerY(), modelMenuOpen, MUTED);

            if (conversation == null || conversation.messages.isEmpty()) drawIdle(canvas);
            else drawConversation(canvas);
            drawComposer(canvas);
            if (modelMenuProgress > .001f) {
                int layer = canvas.saveLayerAlpha(0, 0, getWidth(), getHeight(), Math.max(1, Math.round(modelMenuProgress * 255)));
                float scale = .96f + .04f * modelMenuProgress;
                canvas.scale(scale, scale, modelButton.left, topInset + d(52));
                drawModelPopover(canvas);
                canvas.restoreToCount(layer);
            }
            if (presetMenuProgress > .001f) {
                int layer = canvas.saveLayerAlpha(0, 0, getWidth(), getHeight(), Math.max(1, Math.round(presetMenuProgress * 255)));
                float scale = .96f + .04f * presetMenuProgress;
                canvas.scale(scale, scale, presetButton.right, composerCard.top + d(62));
                drawPresetPopover(canvas);
                canvas.restoreToCount(layer);
            }
        }

        private void drawIdle(Canvas canvas) {
            float composerTop = composerTop();
            float headingY = composerTop - d(61);
            RectF mark = new RectF(getWidth() / 2f - d(20), headingY - d(78), getWidth() / 2f + d(20), headingY - d(38));
            fillRound(canvas, mark, d(14), 0x332F735F);
            strokeRound(canvas, mark, d(14), 0x2E73B29F, d(1));
            iconSparkle(canvas, mark.centerX(), mark.centerY(), d(9), 0xFFC0DED4);

            String greeting = greeting();
            textCentered(canvas, greeting, getWidth() / 2f, headingY, d(getWidth() < d(430) ? 29 : 34), TEXT, false);
            textCentered(canvas, copy("무엇을 함께 살펴볼까요?", "What would you like to explore?"),
                    getWidth() / 2f, headingY + d(29), d(13), MUTED, false);
        }

        private boolean keyboardOpen() { return imeInset > navigationInset + d(40); }

        private float composerTop() {
            if (keyboardOpen()) return Math.max(topInset + d(148), getHeight() - bottomInset - d(108));
            if (conversation == null || conversation.messages.isEmpty()) return getHeight() * .517f;
            return getHeight() - navigationInset - d(132);
        }

        private void drawConversation(Canvas canvas) {
            float y = topInset + d(86);
            float bottom = getHeight() - bottomInset - d(145);
            List<ChatModels.Message> messages = conversation.messages;
            messageHits.clear();
            int start = Math.max(0, messages.size() - 6);
            for (int index = start; index < messages.size(); index++) {
                ChatModels.Message message = messages.get(index);
                float messageTop = y;
                int layer = -1;
                if (index == animatedMessageIndex && messageProgress < 1f) {
                    layer = canvas.saveLayerAlpha(0, 0, getWidth(), getHeight(), Math.max(1, Math.round(messageProgress * 255)));
                    canvas.translate(0, d(10) * (1f - messageProgress));
                }
                if ("user".equals(message.role)) {
                    float width = Math.min(getWidth() * .78f, d(300));
                    float height = measureParagraph(message.content, width - d(30), d(14)) + d(24);
                    RectF bubble = new RectF(getWidth() - d(18) - width, y, getWidth() - d(18), y + height);
                    fillRound(canvas, bubble, d(19), PANEL_RAISED);
                    paragraph(canvas, message.content, bubble.left + d(15), bubble.top + d(12), width - d(30), d(14), TEXT, 1.5f);
                    messageHits.add(new MessageHit(index, new RectF(bubble)));
                    y += height + d(27);
                } else {
                    if (!message.reasoning.isEmpty()) {
                        paint.setColor(0x3873B29F);
                        canvas.drawRect(d(22), y, d(24), y + d(24), paint);
                        iconBrain(canvas, d(36), y + d(9), d(7), MUTED);
                        text(canvas, copy("추론 완료", "Reasoning complete"), d(49), y + d(13), d(12), MUTED, false);
                        y += d(35);
                    }
                    float width = getWidth() - d(44);
                    float height = measureParagraph(message.content, width, d(14)) + d(6);
                    paragraph(canvas, message.content, d(22), y, width, d(14), 0xFFE2E7E3, 1.65f);
                    y += height + d(26);
                    messageHits.add(new MessageHit(index, new RectF(d(16), messageTop - d(8), getWidth() - d(16), Math.max(messageTop + d(44), y))));
                }
                if (layer != -1) canvas.restoreToCount(layer);
                if (y > bottom) break;
            }
            if (generating && y < bottom) {
                text(canvas, copy("생각하는 중…", "Thinking…"), d(22), y + d(8), d(13), MUTED, false);
                long now = android.os.SystemClock.uptimeMillis();
                for (int i = 0; i < 3; i++) {
                    float pulse = .32f + .68f * (float) ((Math.sin(now / 180.0 - i * .8) + 1) / 2);
                    paint.setColor((Math.round(255 * pulse) << 24) | (MUTED & 0x00FFFFFF));
                    canvas.drawCircle(d(25 + i * 11), y + d(25) - d(2) * pulse, d(3), paint);
                }
                postInvalidateDelayed(32);
            }
        }

        private void drawComposer(Canvas canvas) {
            float horizontal = Math.min(d(32), getWidth() * .082f);
            float top = composerTop();
            float bottom = top + d(99);
            composerCard.set(horizontal, top, getWidth() - horizontal, bottom);
            fillRound(canvas, composerCard, d(25), 0xFA1F2421);
            strokeRound(canvas, composerCard, d(25), BORDER_STRONG, d(1));

            composerInput.set(composerCard.left + d(20), composerCard.top + d(14), composerCard.right - d(18), composerCard.top + d(51));
            float actionsY = composerCard.bottom - d(31);
            attachButton.set(composerCard.left + d(13), actionsY - d(17), composerCard.left + d(47), actionsY + d(17));
            iconImagePlus(canvas, attachButton.centerX(), attachButton.centerY(), d(9), MUTED);
            if (!attachmentName.isEmpty()) {
                text(canvas, "1 " + copy("개 이미지", "image attached"), attachButton.right + d(1), actionsY + d(4), d(9), DIM, false);
            }

            sendButton.set(composerCard.right - d(51), actionsY - d(19), composerCard.right - d(13), actionsY + d(19));
            fillRound(canvas, sendButton, d(20), generating ? 0xFF4B524E : ACCENT);
            if (generating) {
                paint.setColor(Color.WHITE);
                canvas.drawRect(sendButton.centerX() - d(4), sendButton.centerY() - d(4), sendButton.centerX() + d(4), sendButton.centerY() + d(4), paint);
            } else iconArrowUp(canvas, sendButton.centerX(), sendButton.centerY(), d(9), Color.WHITE);

            float presetRight = sendButton.left - d(8);
            presetButton.set(presetRight - d(100), actionsY - d(16), presetRight, actionsY + d(16));
            iconBrain(canvas, presetButton.left + d(12), actionsY, d(7), ACCENT_BRIGHT);
            text(canvas, reasoningPreset, presetButton.left + d(25), actionsY + d(4), d(12), 0xFFC3CAC6, false);
            iconChevron(canvas, presetButton.right - d(8), actionsY, presetMenuOpen, MUTED);

            if (!keyboardOpen()) textCentered(canvas, copy("응답이 부정확할 수 있습니다. 중요한 정보는 확인해 주세요.",
                            "Responses may be inaccurate. Verify important information."),
                    getWidth() / 2f, composerCard.bottom + d(20), d(9), 0xFF59615C, false);
            if (!statusMessage.isEmpty()) {
                RectF error = new RectF(composerCard.left, composerCard.top - d(45), composerCard.right, composerCard.top - d(8));
                fillRound(canvas, error, d(11), statusMessage.contains("오류") || statusMessage.startsWith("Server") ? 0x574D2422 : PANEL_SOFT);
                strokeRound(canvas, error, d(11), statusMessage.contains("오류") || statusMessage.startsWith("Server") ? 0x66D27B78 : BORDER, d(1));
                paragraph(canvas, statusMessage, error.left + d(10), error.top + d(9), error.width() - d(20), d(10), 0xFFE4A6A3, 1.25f);
            }
        }

        private void drawModelPopover(Canvas canvas) {
            float left = d(62);
            float top = topInset + d(52);
            float right = Math.min(getWidth() - d(16), left + d(312));
            float height = d(79 + Math.min(models.size(), 4) * 67);
            RectF card = new RectF(left, top, right, top + height);
            fillRound(canvas, card, d(17), 0xFC252A27);
            strokeRound(canvas, card, d(17), BORDER_STRONG, d(1));
            text(canvas, copy("사용 가능한 모델", "Available models"), left + d(16), top + d(23), d(11), MUTED, false);
            text(canvas, String.valueOf(models.size()), right - d(25), top + d(23), d(10), MUTED, false);
            float y = top + d(38);
            for (int i = 0; i < Math.min(models.size(), 4); i++) {
                ChatModels.Model model = models.get(i);
                if (model == selectedModel) iconCheck(canvas, left + d(18), y + d(19), d(6), ACCENT_BRIGHT);
                text(canvas, model.name, left + d(34), y + d(18), d(14), TEXT, false);
                text(canvas, model.id, left + d(34), y + d(34), d(9), MUTED, false);
                text(canvas, model.description, left + d(34), y + d(49), d(9), DIM, false);
                y += d(67);
            }
            paint.setColor(BORDER);
            canvas.drawRect(left + d(9), card.bottom - d(41), right - d(9), card.bottom - d(40), paint);
            iconSliders(canvas, left + d(20), card.bottom - d(20), d(7), MUTED);
            text(canvas, copy("모델 관리", "Manage models"), left + d(34), card.bottom - d(15), d(11), MUTED, false);
        }

        private void drawPresetPopover(Canvas canvas) {
            float right = composerCard.right - d(52);
            float bottom = composerCard.top + d(62);
            RectF card = new RectF(Math.max(d(14), right - d(240)), bottom - d(230), right, bottom);
            fillRound(canvas, card, d(17), 0xFC252A27);
            strokeRound(canvas, card, d(17), BORDER_STRONG, d(1));
            text(canvas, copy("Reasoning 프리셋", "Reasoning preset"), card.left + d(14), card.top + d(22), d(10), DIM, false);
            String[] presets = {"None", "Low", "Medium", "High"};
            for (int index = 0; index < presets.length; index++) {
                float y = card.top + d(48 + index * 40);
                if (presets[index].equals(reasoningPreset)) iconCheck(canvas, card.left + d(17), y, d(6), ACCENT_BRIGHT);
                text(canvas, presets[index], card.left + d(34), y + d(4), d(12), TEXT, false);
                text(canvas, index == 0 ? copy("기본값", "default") : copy("네이티브", "Native"), card.left + d(110), y + d(4), d(9), DIM, false);
            }
        }

        private void drawDrawer(Canvas canvas) {
            paint.setColor((Math.round(0xA8 * drawerProgress) << 24));
            canvas.drawRect(0, 0, getWidth(), getHeight(), paint);
            canvas.save();
            canvas.translate(-d(272) * (1f - drawerProgress), 0);
            float left = d(8);
            float right = Math.min(getWidth() - d(54), d(262));
            float top = topInset + d(8);
            float profileBottom = getHeight() - bottomInset - d(12);
            float profileTop = profileBottom - d(66);
            RectF panel = new RectF(left, top, right, profileTop - d(10));
            fillRound(canvas, panel, d(26), 0xFA191D1B);
            strokeRound(canvas, panel, d(26), BORDER, d(1));

            RectF halo = new RectF(left + d(10), top + d(10), right - d(10), top + d(54));
            paint.setShader(new LinearGradient(halo.left, halo.centerY(), halo.right, halo.centerY(),
                    new int[]{0xFFD98276, 0xFFD3B069, 0xFF59A788, 0xFF4F8FAD}, null, Shader.TileMode.CLAMP));
            canvas.drawRoundRect(halo, d(23), d(23), paint);
            paint.setShader(null);
            RectF inner = new RectF(halo.left + d(1), halo.top + d(1), halo.right - d(1), halo.bottom - d(1));
            fillRound(canvas, inner, d(22), 0xFF0E110F);
            iconNewChat(canvas, inner.left + d(18), inner.centerY(), d(8), TEXT);
            text(canvas, copy("새 채팅", "New Chat"), inner.left + d(35), inner.centerY() + d(5), d(14), 0xFFE8ECE9, false);

            RectF search = new RectF(left + d(10), top + d(63), right - d(10), top + d(107));
            fillRound(canvas, search, d(22), 0xFF0E110F);
            iconSearch(canvas, search.left + d(23), search.centerY(), d(8), TEXT);
            text(canvas, copy("검색", "Search"), search.left + d(44), search.centerY() + d(5), d(14), 0xFFE8ECE9, false);

            text(canvas, copy("채팅 기록", "Chat histories"), left + d(20), top + d(139), d(11), DIM, false);
            iconTrash(canvas, right - d(29), top + d(135), d(7), DIM);
            float y = top + d(165);
            for (int index = 0; index < Math.min(histories.size(), 7); index++) {
                ChatModels.Conversation item = histories.get(index);
                if (item == conversation) fillRound(canvas, new RectF(left + d(10), y - d(22), right - d(10), y + d(12)), d(11), 0x14FFFFFF);
                String title = ellipsize(item.title, 27);
                text(canvas, title, left + d(21), y, d(12), 0xFFCBD1CD, false);
                y += d(42);
            }

            profileButton.set(left, profileTop, right, profileBottom);
            fillRound(canvas, profileButton, d(23), 0xFA191D1B);
            strokeRound(canvas, profileButton, d(23), BORDER, d(1));
            paint.setShader(new LinearGradient(left + d(12), profileTop + d(12), left + d(50), profileBottom - d(12),
                    0xFF599E8C, 0xFF397563, Shader.TileMode.CLAMP));
            canvas.drawCircle(left + d(31), profileButton.centerY(), d(19), paint);
            paint.setShader(null);
            textCentered(canvas, displayName.isEmpty() ? "U" : displayName.substring(0, 1).toUpperCase(Locale.ROOT), left + d(31), profileButton.centerY() + d(5), d(13), Color.WHITE, true);
            text(canvas, displayName, left + d(59), profileButton.centerY() - d(2), d(13), TEXT, true);
            text(canvas, copy("설정 및 연결", "Settings & connections"), left + d(59), profileButton.centerY() + d(17), d(9), MUTED, false);
            iconSliders(canvas, right - d(21), profileButton.centerY(), d(7), DIM);
            canvas.restore();
        }

        private void drawSettings(Canvas canvas) {
            paint.setColor(0xFF141816);
            canvas.drawRect(0, 0, getWidth(), getHeight(), paint);
            float headerTop = topInset;
            text(canvas, copy("워크스페이스", "Workspace"), d(25), headerTop + d(20), d(8), DIM, false);
            text(canvas, copy("설정", "Settings"), d(25), headerTop + d(49), d(22), TEXT, true);
            iconClose(canvas, getWidth() - d(39), headerTop + d(31), d(8), MUTED);
            paint.setColor(BORDER);
            canvas.drawRect(0, headerTop + d(64), getWidth(), headerTop + d(65), paint);

            float tabsTop = headerTop + d(73);
            float tabWidth = getWidth() / 4f;
            for (int index = 0; index < 4; index++) {
                RectF tab = new RectF(index * tabWidth + d(8), tabsTop, (index + 1) * tabWidth - d(8), tabsTop + d(40));
                if (index == settingsTab) fillRound(canvas, tab, d(10), 0x294E9A87);
                float cx = tab.centerX();
                if (index == 0) iconSliders(canvas, cx, tab.centerY(), d(8), index == settingsTab ? 0xFFDFF0EA : MUTED);
                else if (index == 1) iconServer(canvas, cx, tab.centerY(), d(8), index == settingsTab ? 0xFFDFF0EA : MUTED);
                else if (index == 2) iconTune(canvas, cx, tab.centerY(), d(8), index == settingsTab ? 0xFFDFF0EA : MUTED);
                else iconBrain(canvas, cx, tab.centerY(), d(8), index == settingsTab ? 0xFFDFF0EA : MUTED);
            }
            float contentTop = headerTop + d(237);
            paint.setColor(BORDER);
            canvas.drawRect(0, contentTop - d(9), getWidth(), contentTop - d(8), paint);
            if (settingsTab == 0) drawGeneralSettings(canvas, contentTop);
            else if (settingsTab == 1) drawConnectionSettings(canvas, contentTop);
            else if (settingsTab == 2) drawModelSettings(canvas, contentTop);
            else drawReasoningSettings(canvas, contentTop);
            drawSettingsFooter(canvas);
        }

        private void drawSectionTitle(Canvas canvas, float top, int icon, String title, String subtitle) {
            RectF badge = new RectF(d(17), top, d(55), top + d(38));
            fillRound(canvas, badge, d(12), 0x294E9A87);
            strokeRound(canvas, badge, d(12), 0x1A69B6A2, d(1));
            if (icon == 0) iconSliders(canvas, badge.centerX(), badge.centerY(), d(8), ACCENT_BRIGHT);
            else if (icon == 1) iconServer(canvas, badge.centerX(), badge.centerY(), d(8), ACCENT_BRIGHT);
            else if (icon == 2) iconTune(canvas, badge.centerX(), badge.centerY(), d(8), ACCENT_BRIGHT);
            else iconBrain(canvas, badge.centerX(), badge.centerY(), d(8), ACCENT_BRIGHT);
            text(canvas, title, d(67), top + d(18), d(17), TEXT, true);
            text(canvas, subtitle, d(67), top + d(38), d(10), MUTED, false);
        }

        private void drawGeneralSettings(Canvas canvas, float top) {
            drawSectionTitle(canvas, top + d(12), 0, copy("일반 설정", "General settings"), copy("인터페이스와 추론 동작을 설정합니다.", "Choose interface and inference behavior."));
            RectF language = new RectF(d(17), top + d(91), getWidth() - d(17), top + d(248));
            fillRound(canvas, language, d(16), 0x08FFFFFF);
            strokeRound(canvas, language, d(16), BORDER, d(1));
            text(canvas, copy("인터페이스 언어", "Interface language"), language.left + d(18), language.top + d(28), d(12), TEXT, true);
            text(canvas, copy("선택한 언어는 저장되어 다음 접속에도 유지됩니다.", "The selected language is saved for future visits."), language.left + d(18), language.top + d(48), d(9), DIM, false);
            float cardTop = language.top + d(70);
            float gap = d(10);
            float cardWidth = (language.width() - d(36) - gap) / 2f;
            RectF en = new RectF(language.left + d(18), cardTop, language.left + d(18) + cardWidth, language.bottom - d(18));
            RectF ko = new RectF(en.right + gap, cardTop, language.right - d(18), language.bottom - d(18));
            drawLanguageCard(canvas, en, "EN", copy("영어", "English"), "English", !korean);
            drawLanguageCard(canvas, ko, "한", copy("한국어", "Korean"), "한국어", korean);

            RectF demand = new RectF(d(17), top + d(261), getWidth() - d(17), top + d(350));
            fillRound(canvas, demand, d(16), 0x08FFFFFF);
            strokeRound(canvas, demand, d(16), BORDER, d(1));
            text(canvas, "On demand", demand.left + d(18), demand.top + d(31), d(12), TEXT, true);
            paragraph(canvas, copy("추론 요청 전에 /api/inference/load를 호출해 선택한 모델을 로드합니다.", "Load the selected model before each inference request."),
                    demand.left + d(18), demand.top + d(45), demand.width() - d(95), d(9), DIM, 1.3f);
            drawToggle(canvas, demand.right - d(38), demand.centerY(), onDemand);
        }

        private void drawLanguageCard(Canvas canvas, RectF card, String badge, String title, String subtitle, boolean selected) {
            fillRound(canvas, card, d(13), selected ? 0x292E5B50 : 0xFF191D1B);
            strokeRound(canvas, card, d(13), selected ? 0x5269B6A2 : BORDER, d(1));
            RectF icon = new RectF(card.left + d(12), card.centerY() - d(17), card.left + d(46), card.centerY() + d(17));
            fillRound(canvas, icon, d(10), 0x0EFFFFFF);
            textCentered(canvas, badge, icon.centerX(), icon.centerY() + d(4), d(11), 0xFFC7D4CF, true);
            text(canvas, title, card.left + d(56), card.centerY() - d(1), d(11), TEXT, true);
            text(canvas, subtitle, card.left + d(56), card.centerY() + d(15), d(8), DIM, false);
            if (selected) iconCheck(canvas, card.right - d(18), card.centerY(), d(6), ACCENT_BRIGHT);
        }

        private void drawConnectionSettings(Canvas canvas, float top) {
            drawSectionTitle(canvas, top + d(12), 1, copy("OpenAI 호환 서버", "OpenAI-compatible server"), copy("호스팅 API에 연결하고 제공되는 모델을 찾습니다.", "Connect to the hosted API and discover models."));
            float y = top + d(82);
            drawField(canvas, copy("Base URL", "Base URL"), baseUrl, y, false);
            y += d(77);
            drawField(canvas, copy("API 키", "API key"), apiKey.isEmpty() ? copy("현재 서버에서 필요", "Required by the current server") : "••••••••", y, true);
            y += d(77);
            drawField(canvas, copy("표시 이름", "Display name"), displayName, y, false);
            y += d(81);
            RectF detect = new RectF(d(17), y, getWidth() - d(17), y + d(72));
            fillRound(canvas, detect, d(13), 0x0AFFFFFF);
            strokeRound(canvas, detect, d(13), BORDER, d(1));
            text(canvas, copy("모델 및 기능 검색", "Discover models & capabilities"), detect.left + d(14), detect.top + d(25), d(11), TEXT, true);
            text(canvas, copy("서버의 GET /models를 호출합니다.", "Calls GET /models on the server."), detect.left + d(14), detect.top + d(44), d(8), DIM, false);
            RectF button = new RectF(detect.right - d(103), detect.top + d(20), detect.right - d(12), detect.bottom - d(18));
            fillRound(canvas, button, d(9), 0x10FFFFFF);
            textCentered(canvas, copy("모델 검색", "Detect models"), button.centerX(), button.centerY() + d(4), d(9), 0xFFD1D7D3, false);
        }

        private void drawField(Canvas canvas, String label, String value, float top, boolean key) {
            text(canvas, label, d(19), top + d(11), d(10), 0xFFBBC3BE, false);
            RectF box = new RectF(d(17), top + d(20), getWidth() - d(17), top + d(62));
            fillRound(canvas, box, d(10), FIELD);
            strokeRound(canvas, box, d(10), BORDER_STRONG, d(1));
            if (key) iconKey(canvas, box.left + d(18), box.centerY(), d(7), DIM);
            text(canvas, value, box.left + d(key ? 36 : 12), box.centerY() + d(4), d(11), value.startsWith("현재") || value.startsWith("Required") ? DIM : 0xFFE6EBE8, false);
        }

        private void drawModelSettings(Canvas canvas, float top) {
            drawSectionTitle(canvas, top + d(12), 2, copy("모델 및 별칭", "Models & aliases"), copy("채팅 화면에 표시할 서버 모델을 관리합니다.", "Choose models shown in the chat interface."));
            RectF editor = new RectF(d(17), top + d(82), getWidth() - d(17), Math.min(getHeight() - bottomInset - d(82), top + d(430)));
            fillRound(canvas, editor, d(15), 0x05FFFFFF);
            strokeRound(canvas, editor, d(15), BORDER, d(1));
            float listBottom = Math.min(editor.top + d(128), editor.bottom - d(140));
            paint.setColor(BORDER);
            canvas.drawRect(editor.left, listBottom, editor.right, listBottom + d(1), paint);
            text(canvas, copy("모델", "Models"), editor.left + d(13), editor.top + d(25), d(9), DIM, true);
            float y = editor.top + d(56);
            for (int index = 0; index < Math.min(models.size(), 2); index++) {
                ChatModels.Model model = models.get(index);
                RectF row = new RectF(editor.left + d(8), y - d(17), editor.right - d(8), y + d(31));
                if (model == selectedModel) fillRound(canvas, row, d(10), 0x294E9A87);
                iconServer(canvas, row.left + d(18), row.centerY(), d(7), ACCENT_BRIGHT);
                text(canvas, model.name, row.left + d(36), row.top + d(18), d(11), TEXT, true);
                text(canvas, model.id, row.left + d(36), row.top + d(34), d(8), DIM, false);
                y += d(52);
            }
            float paneTop = listBottom + d(18);
            text(canvas, copy("메인 인터페이스에 표시", "Show in main interface"), editor.left + d(14), paneTop + d(14), d(11), TEXT, true);
            text(canvas, copy("이 모델을 모델 선택기에 표시합니다.", "Also show this model in the model picker."), editor.left + d(14), paneTop + d(32), d(8), DIM, false);
            drawToggle(canvas, editor.right - d(38), paneTop + d(18), true);
            text(canvas, copy("표시 이름", "Display name"), editor.left + d(14), paneTop + d(66), d(9), MUTED, false);
            RectF nameBox = new RectF(editor.left + d(14), paneTop + d(76), editor.right - d(14), paneTop + d(116));
            fillRound(canvas, nameBox, d(10), FIELD);
            strokeRound(canvas, nameBox, d(10), BORDER_STRONG, d(1));
            text(canvas, selectedModel.name, nameBox.left + d(11), nameBox.centerY() + d(4), d(11), TEXT, false);
        }

        private void drawReasoningSettings(Canvas canvas, float top) {
            drawSectionTitle(canvas, top + d(12), 3, copy("Reasoning 수준", "Reasoning effort"), copy("모델별 네이티브 추론 수준과 템플릿을 설정합니다.", "Configure native effort levels for each model."));
            RectF capability = new RectF(d(17), top + d(82), getWidth() - d(17), top + d(152));
            fillRound(canvas, capability, d(13), 0x0AFFFFFF);
            strokeRound(canvas, capability, d(13), BORDER, d(1));
            text(canvas, copy("네이티브 Reasoning 지원", "Native reasoning support"), capability.left + d(14), capability.top + d(27), d(11), TEXT, true);
            text(canvas, "API efforts: low, medium, high", capability.left + d(14), capability.top + d(46), d(8), DIM, false);
            drawToggle(canvas, capability.right - d(38), capability.centerY(), true);
            float y = top + d(165);
            String[] presets = {"None", "Low", "Medium", "High"};
            for (String preset : presets) {
                RectF row = new RectF(d(17), y, getWidth() - d(17), y + d(53));
                fillRound(canvas, row, d(13), preset.equals(reasoningPreset) ? 0x214E9A87 : 0x07FFFFFF);
                strokeRound(canvas, row, d(13), BORDER, d(1));
                iconBrain(canvas, row.left + d(24), row.centerY(), d(7), ACCENT_BRIGHT);
                text(canvas, preset, row.left + d(43), row.centerY() + d(4), d(11), TEXT, true);
                text(canvas, preset.equals("None") ? copy("기본값", "default") : copy("네이티브", "Native"), row.right - d(67), row.centerY() + d(4), d(8), DIM, false);
                y += d(62);
            }
        }

        private void drawSettingsFooter(Canvas canvas) {
            float top = getHeight() - bottomInset - d(68);
            paint.setColor(0xFF121613);
            canvas.drawRect(0, top, getWidth(), getHeight(), paint);
            paint.setColor(BORDER);
            canvas.drawRect(0, top, getWidth(), top + d(1), paint);
            if (!statusMessage.isEmpty()) text(canvas, ellipsize(statusMessage, 26), d(14), top + d(40), d(9), MUTED, false);
            RectF cancel = new RectF(getWidth() - d(178), top + d(17), getWidth() - d(112), top + d(53));
            strokeRound(canvas, cancel, d(10), BORDER, d(1));
            textCentered(canvas, copy("취소", "Cancel"), cancel.centerX(), cancel.centerY() + d(4), d(10), MUTED, false);
            RectF save = new RectF(getWidth() - d(104), top + d(17), getWidth() - d(12), top + d(53));
            fillRound(canvas, save, d(10), ACCENT);
            textCentered(canvas, copy("변경사항 저장", "Save changes"), save.centerX(), save.centerY() + d(4), d(10), Color.WHITE, false);
        }

        private void drawToggle(Canvas canvas, float cx, float cy, boolean on) {
            RectF track = new RectF(cx - d(20), cy - d(11), cx + d(20), cy + d(11));
            fillRound(canvas, track, d(12), on ? ACCENT : 0xFF353B37);
            paint.setColor(on ? Color.WHITE : 0xFFAFB7B2);
            canvas.drawCircle(cx + d(on ? 8 : -8), cy, d(8), paint);
        }

        @Override
        public boolean onTouchEvent(MotionEvent event) {
            float x = event.getX();
            float y = event.getY();
            if (event.getAction() == MotionEvent.ACTION_DOWN) {
                gestureDownX = x;
                gestureDownY = y;
                longPressTriggered = false;
                pressedMessageIndex = (!settingsOpen && !drawerOpen && !modelMenuOpen && !presetMenuOpen) ? hitMessage(x, y) : -1;
                if (pressedMessageIndex >= 0) {
                    longPressRunnable = () -> {
                        longPressTriggered = true;
                        performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
                        showMessageActions(pressedMessageIndex);
                    };
                    gestureHandler.postDelayed(longPressRunnable, 520);
                }
                return true;
            }
            if (event.getAction() == MotionEvent.ACTION_MOVE) {
                if (Math.hypot(x - gestureDownX, y - gestureDownY) > d(12) && longPressRunnable != null) gestureHandler.removeCallbacks(longPressRunnable);
                return true;
            }
            if (event.getAction() == MotionEvent.ACTION_CANCEL) {
                if (longPressRunnable != null) gestureHandler.removeCallbacks(longPressRunnable);
                return true;
            }
            if (event.getAction() != MotionEvent.ACTION_UP) return true;
            if (longPressRunnable != null) gestureHandler.removeCallbacks(longPressRunnable);
            longPressRunnable = null;
            if (longPressTriggered) return true;
            if (settingsOpen) return touchSettings(x, y);
            if (drawerOpen) return touchDrawer(x, y);
            if (modelMenuOpen) {
                float left = d(62);
                float cardTop = topInset + d(52);
                float cardRight = Math.min(getWidth() - d(16), left + d(312));
                float cardBottom = cardTop + d(79 + Math.min(models.size(), 4) * 67);
                float optionTop = cardTop + d(38);
                for (int index = 0; index < Math.min(models.size(), 4); index++) {
                    if (x >= left && x <= cardRight && y >= optionTop + index * d(67) && y < optionTop + (index + 1) * d(67)) {
                        selectedModel = models.get(index);
                        setModelMenuOpen(false);
                        return true;
                    }
                }
                if (x >= left && x <= cardRight && y >= cardBottom - d(41) && y <= cardBottom) {
                    setModelMenuOpen(false);
                    setSettingsOpen(true);
                    settingsTab = 2;
                    return true;
                }
                setModelMenuOpen(false);
                return true;
            }
            if (presetMenuOpen) {
                float right = composerCard.right - d(52);
                float bottom = composerCard.top + d(62);
                float top = bottom - d(230) + d(29);
                if (x >= right - d(240) && x <= right && y >= top && y <= bottom - d(25)) {
                    int index = Math.max(0, Math.min(3, (int) ((y - top) / d(40))));
                    reasoningPreset = new String[]{"None", "Low", "Medium", "High"}[index];
                    setPresetMenuOpen(false);
                    return true;
                }
                setPresetMenuOpen(false);
                return true;
            }
            if (menuButton.contains(x, y)) {
                setDrawerOpen(true);
                setModelMenuOpen(false);
                hideKeyboard();
            } else if (modelButton.contains(x, y)) {
                setModelMenuOpen(!modelMenuOpen);
                setPresetMenuOpen(false);
                hideKeyboard();
            } else if (sendButton.contains(x, y)) {
                sendMessage();
            } else if (attachButton.contains(x, y)) {
                pickImage();
            } else if (presetButton.contains(x, y)) {
                setPresetMenuOpen(!presetMenuOpen);
                setModelMenuOpen(false);
                hideKeyboard();
            }
            postInvalidateOnAnimation();
            return true;
        }

        private boolean touchDrawer(float x, float y) {
            float right = Math.min(getWidth() - d(54), d(262));
            float top = topInset + d(8);
            if (x > right) {
                setDrawerOpen(false);
            } else if (y >= top + d(10) && y <= top + d(54)) {
                newChat();
            } else if (y >= top + d(63) && y <= top + d(107)) {
                searching = !searching;
                Toast.makeText(MainActivity.this, copy("검색 입력은 대화가 저장되면 활성화됩니다.", "Search is available for saved chats."), Toast.LENGTH_SHORT).show();
            } else if (profileButton.contains(x, y)) {
                setDrawerOpen(false);
                setSettingsOpen(true);
                settingsTab = 0;
            } else if (y >= top + d(143)) {
                int index = (int) ((y - (top + d(143))) / d(42));
                if (index >= 0 && index < histories.size()) {
                    conversation = histories.get(index);
                    setDrawerOpen(false);
                }
            }
            postInvalidateOnAnimation();
            return true;
        }

        private boolean touchSettings(float x, float y) {
            float headerTop = topInset;
            if (x > getWidth() - d(65) && y < headerTop + d(65)) {
                setSettingsOpen(false);
                return true;
            }
            float tabsTop = headerTop + d(73);
            if (y >= tabsTop && y <= tabsTop + d(48)) {
                settingsTab = Math.max(0, Math.min(3, (int) (x / (getWidth() / 4f))));
                invalidate();
                return true;
            }
            float footerTop = getHeight() - bottomInset - d(68);
            if (y >= footerTop) {
                if (x >= getWidth() - d(108)) saveSettings();
                else if (x >= getWidth() - d(184)) setSettingsOpen(false);
                postInvalidateOnAnimation();
                return true;
            }
            float contentTop = headerTop + d(237);
            if (settingsTab == 0) {
                if (y >= contentTop + d(161) && y <= contentTop + d(248)) {
                    korean = x >= getWidth() / 2f;
                    composer.setHint(korean ? "모델에게 메시지 보내기…" : "Message your model…");
                } else if (y >= contentTop + d(261) && y <= contentTop + d(350)) onDemand = !onDemand;
            } else if (settingsTab == 1) {
                if (y >= contentTop + d(102) && y < contentTop + d(164)) {
                    showFieldEditor("Base URL", baseUrl, false, value -> { baseUrl = value; invalidate(); });
                } else if (y >= contentTop + d(179) && y < contentTop + d(241)) {
                    showFieldEditor(copy("API 키", "API key"), apiKey, true, value -> { apiKey = value; invalidate(); });
                } else if (y >= contentTop + d(256) && y < contentTop + d(318)) {
                    showFieldEditor(copy("표시 이름", "Display name"), displayName, false, value -> { displayName = value; invalidate(); });
                } else if (y >= contentTop + d(340) && y < contentTop + d(430)) discoverModels();
            } else if (settingsTab == 3) {
                int index = (int) ((y - (contentTop + d(165))) / d(62));
                if (index >= 0 && index < 4) reasoningPreset = new String[]{"None", "Low", "Medium", "High"}[index];
            }
            postInvalidateOnAnimation();
            return true;
        }

        private String copy(String ko, String en) { return korean ? ko : en; }

        private int hitMessage(float x, float y) {
            for (int index = messageHits.size() - 1; index >= 0; index--) {
                MessageHit hit = messageHits.get(index);
                if (hit.bounds.contains(x, y)) return hit.index;
            }
            return -1;
        }

        private final class MessageHit {
            final int index;
            final RectF bounds;
            MessageHit(int index, RectF bounds) { this.index = index; this.bounds = bounds; }
        }

        private interface FloatReceiver { void accept(float value); }

        private String greeting() {
            int hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
            String suffix = displayName.isEmpty() ? (korean ? "사용자" : "there") : displayName;
            if (korean) {
                String period = hour < 12 ? "좋은 아침이에요" : hour < 18 ? "좋은 오후예요" : "좋은 저녁이에요";
                return period + ", " + suffix + "님.";
            }
            String period = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
            return period + ", " + suffix + ".";
        }

        private String ellipsize(String value, int max) {
            return value.length() <= max ? value : value.substring(0, Math.max(1, max - 1)) + "…";
        }

        private void fillRound(Canvas canvas, RectF rect, float radius, int color) {
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(color);
            canvas.drawRoundRect(rect, radius, radius, paint);
        }

        private void strokeRound(Canvas canvas, RectF rect, float radius, int color, float width) {
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(width);
            paint.setColor(color);
            canvas.drawRoundRect(rect, radius, radius, paint);
            paint.setStyle(Paint.Style.FILL);
        }

        private void text(Canvas canvas, String value, float x, float baseline, float size, int color, boolean bold) {
            paint.setColor(color);
            paint.setTextSize(size);
            paint.setTypeface(bold ? Typeface.create("sans", Typeface.BOLD) : Typeface.create("sans", Typeface.NORMAL));
            canvas.drawText(value, x, baseline, paint);
        }

        private void textCentered(Canvas canvas, String value, float cx, float baseline, float size, int color, boolean bold) {
            paint.setTextSize(size);
            paint.setTypeface(bold ? Typeface.create("sans", Typeface.BOLD) : Typeface.create("sans", Typeface.NORMAL));
            text(canvas, value, cx - paint.measureText(value) / 2f, baseline, size, color, bold);
        }

        private float measureParagraph(String value, float width, float size) {
            textPaint.setTextSize(size);
            StaticLayout layout = StaticLayout.Builder.obtain(value, 0, value.length(), textPaint, Math.max(1, (int) width))
                    .setLineSpacing(0, 1.45f).build();
            return layout.getHeight();
        }

        private void paragraph(Canvas canvas, String value, float x, float y, float width, float size, int color, float spacing) {
            textPaint.setTextSize(size);
            textPaint.setColor(color);
            textPaint.setTypeface(Typeface.create("sans", Typeface.NORMAL));
            StaticLayout layout = StaticLayout.Builder.obtain(value, 0, value.length(), textPaint, Math.max(1, (int) width))
                    .setAlignment(Layout.Alignment.ALIGN_NORMAL)
                    .setIncludePad(false)
                    .setLineSpacing(0, spacing)
                    .build();
            canvas.save();
            canvas.translate(x, y);
            layout.draw(canvas);
            canvas.restore();
        }

        private void line(Canvas canvas, float x1, float y1, float x2, float y2, int color, float width) {
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(width);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setColor(color);
            canvas.drawLine(x1, y1, x2, y2, paint);
            paint.setStyle(Paint.Style.FILL);
        }

        private void iconHamburger(Canvas c, float x, float y, float r, int color) {
            line(c, x-r, y-r*.65f, x+r, y-r*.65f, color, d(1.6f));
            line(c, x-r, y, x+r, y, color, d(1.6f));
            line(c, x-r, y+r*.65f, x+r, y+r*.65f, color, d(1.6f));
        }

        private void iconChevron(Canvas c, float x, float y, boolean up, int color) {
            float s=d(4); float direction=up?-1:1;
            line(c,x-s,y-direction*s*.45f,x,y+direction*s*.45f,color,d(1.3f));
            line(c,x,y+direction*s*.45f,x+s,y-direction*s*.45f,color,d(1.3f));
        }

        private void iconSparkle(Canvas c, float x, float y, float r, int color) {
            path.reset();
            path.moveTo(x, y-r); path.lineTo(x+r*.28f,y-r*.28f); path.lineTo(x+r,y); path.lineTo(x+r*.28f,y+r*.28f);
            path.lineTo(x,y+r); path.lineTo(x-r*.28f,y+r*.28f); path.lineTo(x-r,y); path.lineTo(x-r*.28f,y-r*.28f); path.close();
            paint.setColor(color); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(d(1.3f)); c.drawPath(path,paint); paint.setStyle(Paint.Style.FILL);
            line(c,x+r*.72f,y-r*.72f,x+r*1.05f,y-r*1.05f,color,d(1.1f));
            line(c,x+r*.89f,y-r*1.22f,x+r*.89f,y-r*.55f,color,d(1.1f));
        }

        private void iconArrowUp(Canvas c,float x,float y,float r,int color){line(c,x,y+r,x,y-r,color,d(1.8f));line(c,x,y-r,x-r*.55f,y-r*.45f,color,d(1.8f));line(c,x,y-r,x+r*.55f,y-r*.45f,color,d(1.8f));}
        private void iconCheck(Canvas c,float x,float y,float r,int color){line(c,x-r,y,x-r*.2f,y+r*.65f,color,d(1.6f));line(c,x-r*.2f,y+r*.65f,x+r,y-r*.7f,color,d(1.6f));}
        private void iconClose(Canvas c,float x,float y,float r,int color){line(c,x-r,y-r,x+r,y+r,color,d(1.5f));line(c,x+r,y-r,x-r,y+r,color,d(1.5f));}

        private void iconSearch(Canvas c,float x,float y,float r,int color){paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(d(1.6f));paint.setColor(color);c.drawCircle(x-r*.2f,y-r*.2f,r*.7f,paint);paint.setStyle(Paint.Style.FILL);line(c,x+r*.35f,y+r*.35f,x+r,y+r,color,d(1.6f));}
        private void iconNewChat(Canvas c,float x,float y,float r,int color){paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(d(1.4f));paint.setColor(color);c.drawRect(x-r,y-r*.75f,x+r,y+r*.55f,paint);paint.setStyle(Paint.Style.FILL);line(c,x-r*.45f,y+r*.55f,x-r*.75f,y+r,color,d(1.4f));line(c,x,y-r*.36f,x,y+r*.18f,color,d(1.3f));line(c,x-r*.28f,y-r*.09f,x+r*.28f,y-r*.09f,color,d(1.3f));}
        private void iconTrash(Canvas c,float x,float y,float r,int color){paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(d(1.2f));paint.setColor(color);c.drawRect(x-r*.65f,y-r*.55f,x+r*.65f,y+r,paint);paint.setStyle(Paint.Style.FILL);line(c,x-r,y-r*.85f,x+r,y-r*.85f,color,d(1.3f));line(c,x-r*.3f,y-r*1.1f,x+r*.3f,y-r*1.1f,color,d(1.3f));}
        private void iconSliders(Canvas c,float x,float y,float r,int color){line(c,x-r,y-r*.55f,x+r,y-r*.55f,color,d(1.2f));line(c,x-r,y+r*.55f,x+r,y+r*.55f,color,d(1.2f));paint.setColor(color);c.drawCircle(x-r*.28f,y-r*.55f,d(2),paint);c.drawCircle(x+r*.3f,y+r*.55f,d(2),paint);}
        private void iconTune(Canvas c,float x,float y,float r,int color){line(c,x-r,y-r*.6f,x+r,y-r*.6f,color,d(1.2f));line(c,x-r,y,x+r,y,color,d(1.2f));line(c,x-r,y+r*.6f,x+r,y+r*.6f,color,d(1.2f));paint.setColor(color);c.drawCircle(x-r*.3f,y-r*.6f,d(2),paint);c.drawCircle(x+r*.35f,y,d(2),paint);c.drawCircle(x-r*.1f,y+r*.6f,d(2),paint);}
        private void iconImagePlus(Canvas c,float x,float y,float r,int color){paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(d(1.3f));paint.setColor(color);c.drawRect(x-r,y-r*.65f,x+r*.65f,y+r*.65f,paint);paint.setStyle(Paint.Style.FILL);path.reset();path.moveTo(x-r*.8f,y+r*.45f);path.lineTo(x-r*.2f,y-r*.05f);path.lineTo(x+r*.48f,y+r*.55f);c.drawPath(path,paint);c.drawCircle(x+r*.12f,y-r*.27f,d(1.6f),paint);line(c,x+r*.65f,y-r,x+r*.65f,y-r*.35f,color,d(1.3f));line(c,x+r*.98f,y-r*.68f,x+r*.32f,y-r*.68f,color,d(1.3f));}
        private void iconServer(Canvas c,float x,float y,float r,int color){paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(d(1.2f));paint.setColor(color);c.drawRoundRect(new RectF(x-r,y-r,x+r,y-r*.1f),d(2),d(2),paint);c.drawRoundRect(new RectF(x-r,y+r*.1f,x+r,y+r),d(2),d(2),paint);paint.setStyle(Paint.Style.FILL);c.drawCircle(x-r*.55f,y-r*.55f,d(1),paint);c.drawCircle(x-r*.55f,y+r*.55f,d(1),paint);}
        private void iconBrain(Canvas c,float x,float y,float r,int color){paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(d(1.2f));paint.setColor(color);c.drawArc(new RectF(x-r,y-r,x,y+r),75,220,false,paint);c.drawArc(new RectF(x,y-r,x+r,y+r),-115,220,false,paint);line(c,x,y-r*.75f,x,y+r*.75f,color,d(1.1f));line(c,x-r*.45f,y,x-r*.05f,y,color,d(1.1f));line(c,x+r*.05f,y-r*.2f,x+r*.5f,y-r*.2f,color,d(1.1f));paint.setStyle(Paint.Style.FILL);}
        private void iconKey(Canvas c,float x,float y,float r,int color){paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(d(1.3f));paint.setColor(color);c.drawCircle(x-r*.35f,y-r*.2f,r*.55f,paint);paint.setStyle(Paint.Style.FILL);line(c,x,y+r*.15f,x+r,y+r*.9f,color,d(1.4f));line(c,x+r*.55f,y+r*.55f,x+r*.8f,y+r*.3f,color,d(1.2f));}
    }
}
