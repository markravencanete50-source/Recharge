import { deleteOwnAccount } from '@/lib/privacy-server';
// The public /delete-account page: a same-origin POST from the signed-in browser.
export const POST = (request: Request) => deleteOwnAccount(request);
