import raw from "../data/two-crossings.json";
import { contentSchema } from "@orden/schema";

export const content = contentSchema.parse(raw);
