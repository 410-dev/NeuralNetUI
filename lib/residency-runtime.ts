import { db } from "./database";
import { ModelResidencyManager } from "./model-residency";

declare global { var neuralModelResidency: ModelResidencyManager | undefined; }
export const modelResidency = globalThis.neuralModelResidency ?? new ModelResidencyManager({
  get(server, model) {
    return db.prepare("SELECT use_count AS count, last_used AS lastUsed FROM model_usage WHERE server_key = ? AND model_id = ?").get(server, model) as { count: number; lastUsed: number } | undefined || { count: 0, lastUsed: 0 };
  },
  record(server, model) {
    db.prepare(`INSERT INTO model_usage(server_key, model_id, use_count, last_used) VALUES (?, ?, 1, ?)
      ON CONFLICT(server_key, model_id) DO UPDATE SET use_count = use_count + 1, last_used = excluded.last_used`).run(server, model, Date.now());
  },
});
globalThis.neuralModelResidency = modelResidency;
