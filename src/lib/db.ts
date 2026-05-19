import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export const ANON_USER_HANDLE = "anon";

let ensureUserPromise: Promise<string> | null = null;

export async function getDefaultUserId(): Promise<string> {
  if (!ensureUserPromise) {
    ensureUserPromise = prisma.user
      .upsert({
        where: { handle: ANON_USER_HANDLE },
        update: {},
        create: { handle: ANON_USER_HANDLE },
        select: { id: true },
      })
      .then((u) => u.id)
      .catch((err) => {
        ensureUserPromise = null;
        throw err;
      });
  }
  return ensureUserPromise;
}
