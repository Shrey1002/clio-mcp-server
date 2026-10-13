import type { ToolDef } from "./define.js";
import { categoryFromName } from "./define.js";
import { readTools } from "./read.tools.js";
import { moneyTools } from "./money.tools.js";
import { writeTools } from "./write.tools.js";
import { updateTools } from "./update.tools.js";
import { deleteTools } from "./delete.tools.js";

export const allTools: ToolDef<any>[] = [...readTools, ...moneyTools, ...writeTools, ...updateTools, ...deleteTools];

// Guard: declared category must agree with the verb in the name (kill switches depend on it).
for (const t of allTools) {
  if (categoryFromName(t.name) !== t.category) throw new Error(`Tool ${t.name} category ${t.category} disagrees with its name`);
}
