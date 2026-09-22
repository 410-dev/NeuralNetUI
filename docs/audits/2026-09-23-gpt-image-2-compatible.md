# GPT Image 2 OpenAI Compatible audit

## Scope

- OpenAI Compatible `gpt-image-2` generation and edit response handling
- Owner-scoped automatic storage and authenticated chat rendering
- Per-model image-generation and image-input capability controls
- Model-picker image badges and attachment enforcement

## Protocol review

- OpenAI's Images API documents `POST /images/generations` with image results in `data[].b64_json` for GPT Image models.
- Image editing uses multipart `POST /images/edits`; GPT Image accepts multiple input images and returns the same base64 image data shape.
- References: [Generate image](https://developers.openai.com/api/reference/cli/resources/images/methods/generate), [Edit image](https://developers.openai.com/api/reference/cli/resources/images/methods/edit), [GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2).

## Implementation notes

- Non-streaming response bodies and decoded images are bounded. Base64 is validated, and the decoded signature must be PNG, JPEG, or WebP.
- Generated files use the existing atomic, quota-aware retained-upload path. Conversation attachment rows protect the file reference, and the UI reads it through `/api/uploads/{id}`.
- Text-only generation calls `/images/generations`. PNG, JPEG, or WebP source images call multipart `/images/edits`, up to 16 inputs.
- Legacy model settings treat a missing `imageInput` value as enabled. Detected OpenAI `gpt-image-2` identifiers enable generation and input automatically; administrators may override either setting.
- Image-input restrictions are enforced in upload, storage selection, clipboard paste, send validation, and server runtime validation.

## Verification

- `npm test`: 206 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: production compilation, TypeScript checking, static generation, and route collection passed.
- MSI packaging and live paid OpenAI generation were not run for this source change.
