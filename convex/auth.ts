import GitHub from "@auth/core/providers/github";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [GitHub],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      if (args.existingUserId) {
        return args.existingUserId;
      }
      if (!args.profile.name) {
        console.error("No name in profile", args.profile);
      }
      return ctx.db.insert("users", {
        isAnonymous: false,
        name: args.profile.name,
        email: args.profile.email,
        image: args.profile.image,
      });
    },
  },
});
