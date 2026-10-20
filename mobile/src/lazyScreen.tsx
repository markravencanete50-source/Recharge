import { Suspense, lazy, type ComponentType } from "react";

// A screen most people seldom open, loaded the first time it shows instead of with the app: the web app's first download
// stays smaller, so it opens sooner. Its own bundle is small and arrives at once; until then nothing is drawn in its place.
export function lazyScreen<P extends object>(load: () => Promise<ComponentType<P>>) {
  const Screen = lazy(async () => ({ default: await load() }));
  return function LazyScreen(props: P) {
    return <Suspense fallback={null}><Screen {...props} /></Suspense>;
  };
}
