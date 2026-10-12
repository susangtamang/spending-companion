import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { ApiErrorFilter, SanitizingValidationPipe } from "./http.js";

const app = await NestFactory.create(AppModule, { rawBody: true });
app.useGlobalPipes(new SanitizingValidationPipe());
app.useGlobalFilters(new ApiErrorFilter());
await app.listen(Number(process.env.PORT ?? 3000));
