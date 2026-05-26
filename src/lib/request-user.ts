import { prisma } from "@/lib/db";
import {
  readCookie,
  parseWalletSessionToken,
  WALLET_SESSION_COOKIE_NAME,
} from "@/lib/auth/walletSession";
import {
  getOrCreateVisitorUser,
  type VisitorUser,
} from "@/lib/visitor";

export interface RequestUser extends VisitorUser {
  authKind: "wallet" | "visitor";
  walletAddress: string | null;
}

export async function getRequestUser(request: Request): Promise<RequestUser> {
  const visitor = await getOrCreateVisitorUser(request);
  const token = readCookie(request, WALLET_SESSION_COOKIE_NAME);
  const session = parseWalletSessionToken(token);
  if (!session) {
    return { ...visitor, authKind: "visitor", walletAddress: null };
  }

  const user = await prisma.user.findFirst({
    where: {
      id: session.userId,
      primaryWalletAddress: session.walletAddress,
    },
    select: {
      id: true,
      plan: true,
      primaryWalletAddress: true,
    },
  });
  if (!user) {
    return { ...visitor, authKind: "visitor", walletAddress: null };
  }

  return {
    id: user.id,
    plan: user.plan,
    visitorId: visitor.visitorId,
    shouldSetCookie: visitor.shouldSetCookie,
    authKind: "wallet",
    walletAddress: user.primaryWalletAddress,
  };
}
