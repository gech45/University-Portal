import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "./db.js";

export const sessionCookieName = "ait_portal_session";
export const sessionDurationMs = 8 * 60 * 60 * 1000;

export interface AuthUser {
  id: number;
  username: string | null;
  email: string | null;
  fullName: string;
  role: "student" | "admin";
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
      sessionTokenHash?: string;
    }
  }
}

interface SessionRow extends RowDataPacket {
  id: number;
  username: string | null;
  email: string | null;
  full_name: string;
  role: "student" | "admin";
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requireAuth(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const token = request.cookies?.[sessionCookieName];
  if (typeof token !== "string" || token.length === 0) {
    response.status(401).json({ error: "Please sign in to continue." });
    return;
  }

  const tokenHash = hashSessionToken(token);
  const [rows] = await pool.execute<SessionRow[]>(
    `SELECT u.id, u.username, u.email, u.full_name, u.role
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > NOW()
     LIMIT 1`,
    [tokenHash],
  );

  const user = rows[0];
  if (!user) {
    response.clearCookie(sessionCookieName, sessionCookieOptions());
    response.status(401).json({ error: "Your session has expired. Please sign in again." });
    return;
  }

  request.authUser = {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
  };
  request.sessionTokenHash = tokenHash;
  next();
}

export function requireRole(role: AuthUser["role"]): RequestHandler {
  return (request, response, next) => {
    if (!request.authUser) {
      response.status(401).json({ error: "Please sign in to continue." });
      return;
    }

    if (request.authUser.role !== role) {
      response.status(403).json({
        error: role === "admin"
          ? "Administrator access is required."
          : "This page is for student accounts.",
      });
      return;
    }

    next();
  };
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: sessionDurationMs,
  };
}
