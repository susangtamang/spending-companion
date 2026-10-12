import { Controller, Get, Header, Headers, Inject, Injectable, ServiceUnavailableException, type NestMiddleware } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";

@Injectable()
export class OperationsService {
  private readonly prisma = process.env.API_USE_IN_MEMORY === "true" ? null : process.env.DATABASE_URL ? new PrismaClient() : null;
  private readonly counts = new Map<string, number>();
  private inFlight = 0;
  public begin() { this.inFlight += 1; }
  public finish(method: string, path: string, status: number) { this.inFlight = Math.max(0, this.inFlight - 1); const key = `${method} ${routeName(path)} ${status}`; this.counts.set(key, (this.counts.get(key) ?? 0) + 1); }
  public async ready() { if (!this.prisma) throw new ServiceUnavailableException("Database is not configured."); await this.prisma.$queryRaw`SELECT 1`; return { status: "ready", timestamp: new Date().toISOString() }; }
  public metrics() { return [`spending_companion_http_in_flight ${this.inFlight}`,...[...this.counts.entries()].map(([key,value])=>{const [method,route,status]=key.split(" ");return `spending_companion_http_requests_total{method="${method}",route="${route}",status="${status}"} ${value}`;})].join("\n")+"\n"; }
  public async onApplicationShutdown() { await this.prisma?.$disconnect(); }
}

@Injectable()
export class OperationalMiddleware implements NestMiddleware {
  public constructor(@Inject(OperationsService) private readonly operations: OperationsService) {}
  public use(request: Request, response: Response, next: NextFunction) { const started=Date.now(); this.operations.begin(); response.once("finish",()=>{const durationMs=Date.now()-started;this.operations.finish(request.method,request.path,response.statusCode);if(process.env.STRUCTURED_LOGGING==="true") console.info(JSON.stringify({event:"http_request",requestId:request.requestId??"unknown",method:request.method,path:routeName(request.path),status:response.statusCode,durationMs}));});next(); }
}

@Controller()
export class OperationsController {
  public constructor(@Inject(OperationsService) private readonly operations: OperationsService) {}
  @Get("ready") public ready() { return this.operations.ready(); }
  @Get("internal/metrics") @Header("Content-Type", "text/plain; version=0.0.4") public metrics(@Headers("authorization") authorization?: string) { const expected=process.env.OPERATIONS_TOKEN; if(!expected||authorization!==`Bearer ${expected}`) throw new ServiceUnavailableException("Metrics are unavailable."); return this.operations.metrics(); }
}

function routeName(path: string) { return path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,":id").replace(/\/+/g,"/"); }
