import { deleteOwnAccount, privacyRead } from '../../../../lib/privacy-server';
// Your own data from the browser app: GET ?section=deletion|export, POST deletes your account.
export const GET = (request: Request) => privacyRead(request);
export const POST = (request: Request) => deleteOwnAccount(request);
