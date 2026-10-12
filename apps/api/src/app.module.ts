import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { ApiController, HealthController } from "./controller.js";
import { ApiService } from "./service.js";
import { AUTH_PORT, CLOCK_PORT, REPOSITORY_PORT } from "./ports.js";
import { InMemoryRepository } from "./memory.js";
import { BearerGuard } from "./security.js";
import { MutationIdempotencyGuard } from "./idempotency.js";
import { RequestIdMiddleware } from "./http.js";
import { PlaidController, PlaidWebhookController } from "./plaid.controller.js";
import { PLAID_FEATURE, PlaidFeature } from "./plaid-feature.js";
import { ClerkAuthPort } from "./clerk.js";
import { PostgresRepository } from "./postgres.js";
import { PrismaClient } from "@prisma/client";
import { ImportController } from "./import.controller.js";
import { IMPORT_FEATURE, ImportFeature } from "./import-feature.js";
import { ReconciliationController } from "./reconciliation.controller.js";
import { RECONCILIATION_FEATURE, ReconciliationFeature } from "./reconciliation-feature.js";
import { PrivacyController } from "./privacy.controller.js";
import { PRIVACY_FEATURE, PrivacyFeature } from "./privacy-feature.js";
import { OperationsController, OperationalMiddleware, OperationsService } from "./operations.js";

export class RejectingAuthPort { public async verify(): Promise<never> { throw new Error("Configure Clerk AuthPort before serving authenticated traffic."); } }
export class SystemClock { public now(): string { return new Date().toISOString(); } }

@Module({
  controllers: [HealthController, OperationsController, ApiController, PlaidController, PlaidWebhookController, ImportController, ReconciliationController, PrivacyController],
  providers: [ApiService, BearerGuard, MutationIdempotencyGuard, OperationsService, OperationalMiddleware,
    { provide: AUTH_PORT, useFactory: () => configuredAuth() },
    { provide: REPOSITORY_PORT, useFactory: () => configuredRepository() },
    { provide: CLOCK_PORT, useClass: SystemClock },
    { provide: PLAID_FEATURE, useFactory: () => PlaidFeature.fromEnvironment(process.env) },
    { provide: IMPORT_FEATURE, useFactory: () => ImportFeature.fromEnvironment(process.env) },
    { provide: RECONCILIATION_FEATURE, useFactory: () => ReconciliationFeature.fromEnvironment(process.env) },
    { provide: PRIVACY_FEATURE, useFactory: () => PrivacyFeature.fromEnvironment(process.env) }],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void { consumer.apply(RequestIdMiddleware, OperationalMiddleware).forRoutes("*"); }
}

function configuredAuth() {
  if (process.env.API_USE_IN_MEMORY === "true" && process.env.NODE_ENV !== "production") return new RejectingAuthPort();
  return new ClerkAuthPort(process.env);
}
function configuredRepository() {
  if (process.env.API_USE_IN_MEMORY === "true" && process.env.NODE_ENV !== "production") return new InMemoryRepository();
  if (!process.env.DATABASE_URL) throw new Error("Persistence is not configured: DATABASE_URL is required.");
  return new PostgresRepository(new PrismaClient());
}
