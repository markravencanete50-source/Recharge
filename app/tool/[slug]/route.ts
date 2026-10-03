import { NextResponse } from "next/server";
import {
  getChatGPTUser,
  chatGPTSignInPath,
} from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { MODULES, type ModuleId } from "@/lib/modules";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const user = await getChatGPTUser();
  if (!user) {
    return NextResponse.redirect(
      new URL(chatGPTSignInPath("/tool/" + slug), request.url),
    );
  }

  const module = MODULES.find((item) => item.id === slug);
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!module?.url || !profile?.modules.includes(slug as ModuleId)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.redirect(module.url);
}
