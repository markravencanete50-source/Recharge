import { deleteOwnAccount, privacyRead } from '../../../../lib/privacy-server';
// Your own data from the phone app: GET ?section=deletion|export, POST deletes your account.
export const GET = (request: Request) => privacyRead(request, true);
export const POST = (request: Request) => deleteOwnAccount(request, true);
