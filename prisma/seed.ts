import { PrismaClient } from "@prisma/client";
import {
  DEFAULT_PRIORITIES,
  runComparison,
  type ComparisonInput,
} from "../src/lib/comparison";
import { getGenLayerService } from "../src/lib/genlayer";

const prisma = new PrismaClient();
const ANON_HANDLE = "anon";

async function main() {
  const user = await prisma.user.upsert({
    where: { handle: ANON_HANDLE },
    update: {},
    create: { handle: ANON_HANDLE },
    select: { id: true },
  });

  const input: ComparisonInput = {
    prompt: "Best smartphone for daily use, ~$1000 budget",
    options: [
      { id: "iphone-16", name: "iPhone 16", notes: "Tight ecosystem, strong cameras" },
      { id: "pixel-9", name: "Pixel 9", notes: "Best Google AI, clean Android" },
      { id: "galaxy-s24", name: "Galaxy S24", notes: "Versatile hardware, S Pen optional" },
    ],
    priorities: { ...DEFAULT_PRIORITIES, quality: 70, durability: 65, price: 40 },
    mustHaves: "5G, OLED display, 2+ years of OS updates",
    dealBreakers: "No headphone jack is fine; locked bootloader is not",
  };

  const result = runComparison(input);

  const comparison = await prisma.comparison.upsert({
    where: { id: "seed-comparison-phones" },
    update: {
      input: JSON.stringify(input),
      result: JSON.stringify(result),
    },
    create: {
      id: "seed-comparison-phones",
      userId: user.id,
      input: JSON.stringify(input),
      result: JSON.stringify(result),
    },
    select: { id: true },
  });

  const top = result.topPick;
  await prisma.watchlistEntry.upsert({
    where: {
      comparisonId_payloadHash: {
        comparisonId: comparison.id,
        payloadHash: result.receiptPayloadHash,
      },
    },
    update: {},
    create: {
      userId: user.id,
      comparisonId: comparison.id,
      optionId: top.id,
      name: top.name,
      score: top.finalScore,
      payloadHash: result.receiptPayloadHash,
    },
  });

  const receipt = getGenLayerService().buildReceipt(result);
  await prisma.receipt.upsert({
    where: { comparisonId: comparison.id },
    update: {
      payloadHash: receipt.payloadHash,
      status: receipt.status,
      network: receipt.network,
      submitterKind: "mock",
      creatorAddress: null,
      contractAddress: receipt.contractAddress,
      transactionHash: receipt.transactionHash,
      executionResult: null,
      errorCode: null,
    },
    create: {
      id: receipt.id,
      comparisonId: comparison.id,
      payloadHash: receipt.payloadHash,
      status: receipt.status,
      network: receipt.network,
      submitterKind: "mock",
      creatorAddress: null,
      contractAddress: receipt.contractAddress,
      transactionHash: receipt.transactionHash,
      executionResult: null,
      errorCode: null,
      createdAt: new Date(receipt.createdAt),
    },
  });

  console.log(
    `Seeded user=${user.id} comparison=${comparison.id} top="${top.name}" (${top.finalScore})`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
