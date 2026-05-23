import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "./db";

export const VISITOR_COOKIE_NAME = "cl_visitor";
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const VISITOR_ID_RE = /^v_[a-z0-9_-]{16,80}$/;

export interface VisitorUser {
  id: string;
  plan: string;
  visitorId: string;
  shouldSetCookie: boolean;
}

export function createVisitorId(): string {
  return `v_${randomUUID()}`;
}

export function isValidVisitorId(value: unknown): value is string {
  return typeof value === "string" && VISITOR_ID_RE.test(value);
}

function parseCookieHeader(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
}

export async function getOrCreateVisitorUser(
  request: Request,
): Promise<VisitorUser> {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const existingVisitorId = cookies.get(VISITOR_COOKIE_NAME);
  const hasValidVisitor = isValidVisitorId(existingVisitorId);
  const visitorId = hasValidVisitor ? existingVisitorId : createVisitorId();
  const user = await prisma.user.upsert({
    where: { handle: `visitor:${visitorId}` },
    update: {},
    create: { handle: `visitor:${visitorId}` },
    select: { id: true, plan: true },
  });

  return {
    id: user.id,
    plan: user.plan,
    visitorId,
    shouldSetCookie: !hasValidVisitor,
  };
}

export function applyVisitorCookie<T extends NextResponse>(
  response: T,
  visitor: VisitorUser,
): T {
  if (!visitor.shouldSetCookie) return response;
  response.cookies.set({
    name: VISITOR_COOKIE_NAME,
    value: visitor.visitorId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}

export function visitorJson(
  visitor: VisitorUser,
  body: unknown,
  init?: ResponseInit,
): NextResponse {
  return applyVisitorCookie(NextResponse.json(body, init), visitor);
}
