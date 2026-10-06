// Only the isolated browser preview uses this adapter. Production keeps Next routing.
export function useRouter() {
  return { refresh() { window.location.reload(); } };
}
