import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

interface ResponseBody {
    errorCode: string;
    errorMessage: string;
    messageVars?: string[];
    numericErrorCode: number;
    originatingService: string;
    intent: string;
    validationFailures?: Record<string, object>;
}

export class ApiError {
    statusCode: number;
    public response: ResponseBody;

    constructor(code: string, message: string, numeric: number, statusCode: number, ...messageVariables: string[]) {
        this.statusCode = statusCode;
        this.response = {
            errorCode: code,
            errorMessage: message,
            messageVars: messageVariables.length > 0 ? messageVariables : undefined,
            numericErrorCode: numeric,
            originatingService: 'tailflare',
            intent: 'unknown',
        };
    }

    withMessage(message: string): this {
        this.response.errorMessage = message;
        return this;
    }

    originatingService(service: string): this {
        this.response.originatingService = service;
        return this;
    }

    with(...messageVariables: string[]): this {
        this.response.messageVars = this.response.messageVars ? [...this.response.messageVars, ...messageVariables] : messageVariables;
        return this;
    }

    apply(c: Context): ResponseBody {
        this.response.errorMessage = this.getMessage();
        c.res.headers.set('Content-Type', 'application/json');
        c.res.headers.set('X-Epic-Error-Code', `${this.response.numericErrorCode}`);
        c.res.headers.set('X-Epic-Error-Name', this.response.errorCode);
        c.status(this.statusCode as unknown as ContentfulStatusCode);
        return this.response;
    }

    getMessage(): string {
        return (
            this.response.messageVars?.reduce((message, msgVar, index) => message.replace(`{${index}}`, msgVar), this.response.errorMessage) ||
            this.response.errorMessage
        );
    }

    shortenedError(): string {
        return `${this.response.errorCode} - ${this.response.errorMessage}`;
    }

    toResponse(): Response {
        return new Response(JSON.stringify(this.response), {
            status: this.statusCode,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    throwHttpException(): never {
        const errorResponse = new Response(JSON.stringify(this.response), {
            status: this.statusCode,
            headers: {
                'Content-Type': 'application/json',
                'X-Epic-Error-Code': `${this.response.numericErrorCode}`,
                'X-Epic-Error-Name': this.response.errorCode,
            },
        });
        throw new HTTPException(this.statusCode as unknown as ContentfulStatusCode, { res: errorResponse });
    }

    devMessage(message: string, devMode: string | undefined) {
        if (devMode !== 'true') { return this; }
        this.response.errorMessage += `(Dev: -${message}-)`;
        return this;
    }
}

export const errors = {
    badRequest: new ApiError('errors.tailflare.badRequest', 'Bad request', 1001, 400),
    unauthorized: new ApiError('errors.tailflare.unauthorized', 'Unauthorized', 1002, 401),
    forbidden: new ApiError('errors.tailflare.forbidden', 'Forbidden', 1003, 403),
    notFound: new ApiError('errors.tailflare.notFound', 'Not found', 1004, 404),
    methodNotAllowed: new ApiError('errors.tailflare.methodNotAllowed', 'Method not allowed', 1005, 405),
    conflict: new ApiError('errors.tailflare.conflict', 'Conflict', 1006, 409),
    tooManyRequests: new ApiError('errors.tailflare.tooManyRequests', 'Too many requests', 1007, 429),
    internalServerError: new ApiError('errors.tailflare.internalServerError', 'Internal server error', 1008, 500),
    notImplemented: new ApiError('errors.tailflare.notImplemented', 'Not implemented', 1009, 501),
    badGateway: new ApiError('errors.tailflare.badGateway', 'Bad gateway', 1010, 502),
    serviceUnavailable: new ApiError('errors.tailflare.serviceUnavailable', 'Service unavailable', 1011, 503),
    proxy: {
        invalidUrl: new ApiError('errors.tailflare.proxy.invalidUrl', 'Invalid URL provided', 2001, 400),
        connectionFailed: new ApiError('errors.tailflare.proxy.connectionFailed', 'Failed to connect to target', 2002, 502),
        timeout: new ApiError('errors.tailflare.proxy.timeout', 'Request timeout', 2003, 504),
        invalidMethod: new ApiError('errors.tailflare.proxy.invalidMethod', 'HTTP method not supported', 2004, 405),
        invalidHeaders: new ApiError('errors.tailflare.proxy.invalidHeaders', 'Invalid request headers', 2005, 400),
        responseTooLarge: new ApiError('errors.tailflare.proxy.responseTooLarge', 'Response too large', 2006, 413),
        upstreamError: new ApiError('errors.tailflare.proxy.upstreamError', 'Upstream service error', 2007, 502),
    },
    tailscale: {
        proxyFailed: new ApiError('errors.tailflare.tailscale.proxyFailed', 'Failed to proxy request', 3000, 500),
        notAuthenticated: new ApiError('errors.tailflare.tailscale.notAuthenticated', 'Not authenticated with Tailscale', 3001, 401),
        invalidNode: new ApiError('errors.tailflare.tailscale.invalidNode', 'Invalid Tailscale node', 3002, 400),
        networkUnavailable: new ApiError('errors.tailflare.tailscale.networkUnavailable', 'Tailscale network unavailable', 3003, 503),
        permissionDenied: new ApiError('errors.tailflare.tailscale.permissionDenied', 'Permission denied for Tailscale operation', 3004, 403),
        nodeNotFound: new ApiError('errors.tailflare.tailscale.nodeNotFound', 'Tailscale node not found', 3005, 404),
        connectionRefused: new ApiError('errors.tailflare.tailscale.connectionRefused', 'Tailscale connection refused', 3006, 502),
        authenticationExpired: new ApiError('errors.tailflare.tailscale.authExpired', 'Tailscale authentication expired', 3007, 401),
    },
    websocket: {
        connectionFailed: new ApiError('errors.tailflare.websocket.connectionFailed', 'WebSocket connection failed', 4001, 500),
        protocolError: new ApiError('errors.tailflare.websocket.protocolError', 'WebSocket protocol error', 4002, 400),
        timeout: new ApiError('errors.tailflare.websocket.timeout', 'WebSocket timeout', 4003, 408),
    },
    durableObject: {
        notFound: new ApiError('errors.tailflare.durableObject.notFound', 'Durable Object not found', 5001, 404),
        storageError: new ApiError('errors.tailflare.durableObject.storageError', 'Durable Object storage error', 5002, 500),
        migrationError: new ApiError('errors.tailflare.durableObject.migrationError', 'Durable Object migration error', 5003, 500),
    },

    // Utility function for custom errors
    customError(code: string, message: string, numericErrorCode: number, status: number) {
        return new ApiError(code, message, numericErrorCode, status);
    },
};

