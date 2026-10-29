import { Router } from 'express';
import { extractCredentialsFromBody, requireWebhookSecret } from '../middleware/auth.js';
import {
  receiveCredentialWebhook,
  receiveCredentialBulkWebhook,
} from '../controllers/webhookController.js';
import { importCredentials, rollbackImport } from '../controllers/importController.js';

const router = Router();

// Bulk upsert (registered before '/' — both are POST but on distinct paths).
router.post('/bulk', receiveCredentialBulkWebhook);

// Insert-only, transactional bulk import + its rollback.
router.post('/import', requireWebhookSecret(), importCredentials);
router.post('/import/rollback', requireWebhookSecret(), rollbackImport);

router.post('/', extractCredentialsFromBody(), receiveCredentialWebhook);

export default router;
