import { openDatabase, type Db } from "../src/database/client.js";

export function createTestDb(): Db {
  return openDatabase(":memory:");
}
