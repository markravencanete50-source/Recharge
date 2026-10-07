// The browser build of the app (served at /workspace) calls the web twin of each /api/mobile
// route. Most are /api/workspace/<name>; the main one, /api/mobile/workspace, is /api/workspace.
export function webWorkspacePath(path: string) {
  return path.replace(/^\/api\/mobile\/workspace(?=[/?]|$)/, "/api/workspace").replace(/^\/api\/mobile\//, "/api/workspace/");
}
