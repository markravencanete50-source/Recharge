import { staySurveyAnswerRoute } from '../../../lib/stay-reason-server';
export const POST = (request: Request) => staySurveyAnswerRoute(request);
