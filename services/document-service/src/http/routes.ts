import { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { DocumentService } from '../application/document-service';
import { authMiddleware } from '@amacc/shared-kernel';

export function documentRoutes(documentService: DocumentService) {
  return async function (app: FastifyInstance) {
    const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
    app.addHook('preHandler', authMiddleware(JWT_SECRET));

    await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

    // POST /api/v1/documents/upload
    app.post('/upload', async (request, reply) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || '';
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });

      const buffer = await data.toBuffer();
      const result = await documentService.upload(
        tenantId,
        data.filename,
        data.mimetype,
        buffer,
      );
      return reply.status(201).send(result);
    });

    // GET /api/v1/documents/:id
    app.get('/:id', async (request, reply) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || '';
      const { id } = request.params as { id: string };
      const doc = await documentService.getDocument(id, tenantId);
      if (!doc) return reply.status(404).send({ error: 'Not found' });
      return reply.send(doc);
    });

    // POST /api/v1/documents/:id/approve
    app.post('/:id/approve', async (request, reply) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || '';
      const { id } = request.params as { id: string };
      const approvedBy = (request.headers['x-user-id'] as string) ?? 'system';
      const result = await documentService.approve(id, tenantId, approvedBy);
      return reply.send(result);
    });

    // GET /api/v1/documents
    app.get('/', async (request, reply) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || '';
      const { status } = request.query as { status?: string };
      const docs = await documentService.listDocuments(tenantId, status);
      return reply.send(docs);
    });
  };
}
