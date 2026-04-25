import NextAuth, { type DefaultSession } from "next-auth";
// Type-only import to force TS to resolve the module before augmentation.
// Next.js 16 + "moduleResolution: bundler" 에서 순수 `declare module` 만 두면
// "Invalid module name in augmentation" 로 터지므로 명시 import 필요.
import type {} from "next-auth/jwt";
import Kakao from "next-auth/providers/kakao";

import { grantSignupBonusIfNeeded } from "@/lib/balances";
import { query } from "@/lib/db";

// session.user.id 타입 확장
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  // AUTH_KAKAO_ID / AUTH_KAKAO_SECRET 는 .env.local 에서 자동 로드.
  // 구글/애플은 준비되는 대로 아래 배열에 추가.
  providers: [Kakao],

  session: { strategy: "jwt" },

  pages: {
    signIn: "/login",
  },

  callbacks: {
    // OAuth 로그인 성공 시 users / user_accounts 에 upsert.
    // 동일 provider+provider_account_id 는 기존 user_id 재사용.
    async signIn({ user, account }) {
      if (!account) return false;

      const { provider, providerAccountId } = account;

      const existing = await query<{ user_id: string }>(
        `SELECT user_id::text AS user_id
           FROM user_accounts
          WHERE provider = $1 AND provider_account_id = $2`,
        [provider, providerAccountId],
      );

      let userId: string;
      if (existing.length > 0) {
        userId = existing[0].user_id;
        await query(
          `UPDATE users
              SET email = COALESCE($2, email),
                  name  = COALESCE($3, name),
                  image = COALESCE($4, image)
            WHERE id = $1::bigint`,
          [userId, user.email ?? null, user.name ?? null, user.image ?? null],
        );
      } else {
        const rows = await query<{ id: string }>(
          `INSERT INTO users (email, name, image)
           VALUES ($1, $2, $3)
           RETURNING id::text AS id`,
          [user.email ?? null, user.name ?? null, user.image ?? null],
        );
        userId = rows[0].id;
        await query(
          `INSERT INTO user_accounts (user_id, provider, provider_account_id)
           VALUES ($1::bigint, $2, $3)`,
          [userId, provider, providerAccountId],
        );
      }

      // 가입 보너스 100만P (없으면) — user_balances row + SIGNUP_GRANT 원장.
      // 멱등성 보장: 두 번째 로그인부터는 no-op.
      try {
        await grantSignupBonusIfNeeded(userId);
      } catch (e) {
        // 잔액 row 생성 실패해도 로그인 자체는 막지 않음 — 첫 베팅 시도 때 다시 시도된다.
        console.warn("grantSignupBonusIfNeeded failed", e);
      }

      // jwt 콜백으로 DB 사용자 id 를 넘기기 위한 채널.
      user.id = userId;
      return true;
    },

    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
      }
      return token;
    },

    async session({ session, token }) {
      if (typeof token.userId === "string") {
        session.user.id = token.userId;
      }
      return session;
    },
  },
});
