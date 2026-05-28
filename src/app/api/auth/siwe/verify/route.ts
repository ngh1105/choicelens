import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  isSiweAuthError,
  verifySiweForUser,
} from "@/lib/auth/siwe";
import {
  applyWalletSessionCookie,
  createWalletSessionToken,
} from "@/lib/auth/walletSession";
import { isBillingEnabled } from "@/lib/billing/flag";
import { prisma } from "@/lib/db";
import { getOrCreateVisitorUser, visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

function isVerifyPayload(
  value: unknown,
): value is { message: string; signature: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { message?: unknown }).message === "string" &&
    typeof (value as { signature?: unknown }).signature === "string"
  );
}

function isUniqueConflict(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  let visitor;
  try {
    visitor = await getOrCreateVisitorUser(request);
  } catch (err) {
    console.error("POST /api/auth/siwe/verify failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return visitorJson(visitor, { error: "invalid_json" }, { status: 400 });
  }
  if (!isVerifyPayload(payload)) {
    return visitorJson(visitor, { error: "invalid_input" }, { status: 400 });
  }

  try {
    const { walletAddress } = await verifySiweForUser({
      userId: visitor.id,
      message: payload.message,
      signature: payload.signature,
    });
    const currentUser = await prisma.user.findUnique({
      where: { id: visitor.id },
      select: { primaryWalletAddress: true },
    });
    if (
      currentUser?.primaryWalletAddress &&
      currentUser.primaryWalletAddress !== walletAddress
    ) {
      return visitorJson(
        visitor,
        { error: "wallet_change_required" },
        { status: 409 },
      );
    }
    const linkedUser = await prisma.user.findUnique({
      where: { primaryWalletAddress: walletAddress },
      select: { id: true },
    });
    if (linkedUser && linkedUser.id !== visitor.id) {
      return visitorJson(
        visitor,
        { error: "wallet_already_linked" },
        { status: 409 },
      );
    }

    let user;
    try {
      user = await prisma.user.update({
        where: { id: visitor.id },
        data: {
          primaryWalletAddress: walletAddress,
          walletLinkedAt: new Date(),
          ...(!isBillingEnabled() ? { plan: "plus" } : {}),
        },
        select: {
          id: true,
          plan: true,
          primaryWalletAddress: true,
          recoveryEmail: true,
          stripeSubscriptionStatus: true,
          stripeCurrentPeriodEnd: true,
        },
      });
    } catch (err) {
      if (isUniqueConflict(err)) {
        return visitorJson(
          visitor,
          { error: "wallet_already_linked" },
          { status: 409 },
        );
      }
      throw err;
    }
    const response = visitorJson(visitor, { account: user });
    return applyWalletSessionCookie(
      response,
      createWalletSessionToken({
        userId: user.id,
        walletAddress,
      }),
    );
  } catch (err) {
    if (isSiweAuthError(err)) {
      const status = err.code === "nonce_not_found" ? 410 : 400;
      return visitorJson(visitor, { error: err.code }, { status });
    }
    console.error("POST /api/auth/siwe/verify failed", err);
    return visitorJson(visitor, { error: "internal_error" }, { status: 500 });
  }
}
