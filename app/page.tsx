import { redirect } from "next/navigation";

// The old portal has been retired. Everyone signs in to the live workspace.
export default function Home() {
  redirect("/workspace");
}
