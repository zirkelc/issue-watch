import { runAsWorker } from 'synckit';
import { createStatusHandler, type StatusRequest } from './service/handler.js';

const handler = createStatusHandler();

runAsWorker(async (request: StatusRequest) => handler(request));
