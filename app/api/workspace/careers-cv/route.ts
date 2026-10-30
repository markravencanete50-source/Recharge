import { careersCvRoute } from '../../../../lib/careers-server';
export const GET = (request: Request) => careersCvRoute(request);
