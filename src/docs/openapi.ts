import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_KEY_HEADER, API_KEY_SECURITY_SCHEME } from '../auth/api-key.constants';

export const OPENAPI_PATH = 'docs';

const DESCRIPTION = `
Tracks the credit capacity of financing programs in real time.

* A **program** has a total credit limit in its own currency.
* Approving an invoice for early payment **reserves** part of that capacity; repayment **releases** it.
* Invoice and program currencies may differ; amounts are converted at the configured rate and rounded up.
* Treasury publishes limit changes and periodic full-state snapshots over Kafka; those are authoritative.

All amounts are decimal **strings** (never floats). All endpoints except \`/health\` require an API key
in the \`${API_KEY_HEADER}\` header; write operations need a key with the \`write\` scope.
`;

export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Program Capacity Service')
    .setDescription(DESCRIPTION.trim())
    .setVersion('1.0')
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: API_KEY_HEADER,
        description: 'API key issued to the client. Scopes: read, write.',
      },
      API_KEY_SECURITY_SCHEME,
    )
    .addTag('Programs', 'Programs and their live capacity')
    .addTag('Reservations', 'Invoice reservations and releases')
    .addTag('Health', 'Liveness')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(OPENAPI_PATH, app, document, {
    jsonDocumentUrl: `${OPENAPI_PATH}/openapi.json`,
    customSiteTitle: 'Program Capacity Service API',
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
  });
}
