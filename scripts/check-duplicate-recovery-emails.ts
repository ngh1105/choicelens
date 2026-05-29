import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const duplicates = await prisma.user.groupBy({
    by: ["recoveryEmail"],
    where: { recoveryEmail: { not: null } },
    _count: { recoveryEmail: true },
    having: { recoveryEmail: { _count: { gt: 1 } } },
    orderBy: { recoveryEmail: "asc" },
  });

  if (duplicates.length === 0) {
    console.log("No duplicate recoveryEmail values found.");
    return;
  }

  console.log(`Found ${duplicates.length} duplicate recoveryEmail value(s):`);
  for (const duplicate of duplicates) {
    const email = duplicate.recoveryEmail;
    if (!email) continue;
    const users = await prisma.user.findMany({
      where: { recoveryEmail: email },
      select: {
        id: true,
        handle: true,
        primaryWalletAddress: true,
        recoveryEmailVerifiedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    console.log(JSON.stringify({ recoveryEmail: email, users }, null, 2));
  }

  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
