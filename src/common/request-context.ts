import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { HTTP_HEADER, SYSTEM_USER_AGENT, USER_AGENT_MAX_LENGTH } from '@/constants';

/** Who is making the request. Used for rate limits, the device list and the audit log. */
export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Controller parameter decorator: @CurrentRequest() request: RequestContext
 *
 * The IP comes from Express's `request.ip`. Behind a load balancer, set app.set('trust proxy', 1)
 * in your main.ts, or every request will appear to come from the load balancer.
 */
export const CurrentRequest = createParamDecorator((_unused: unknown, executionContext: ExecutionContext): RequestContext => {
  const request = executionContext.switchToHttp().getRequest();
  const userAgent: string | undefined = request.headers?.[HTTP_HEADER.userAgent];
  return {
    ipAddress: request.ip ?? null,
    userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX_LENGTH) : null,
  };
});

/** For calls made from your own code (scripts, admin tools) rather than an HTTP request. */
export const SYSTEM_REQUEST: RequestContext = { ipAddress: null, userAgent: SYSTEM_USER_AGENT };
