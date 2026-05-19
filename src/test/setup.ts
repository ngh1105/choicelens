import { config } from "dotenv";
config({ path: ".env.test", override: false });

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/test.db";
process.env.GENLAYER_NETWORK = process.env.GENLAYER_NETWORK ?? "mock";
