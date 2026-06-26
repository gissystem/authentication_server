import { Router } from 'express';
import { extractCredentialsFromBody } from '../middleware/auth.js';
import {
  receiveCredentialWebhook,
  receiveCredentialBulkWebhook,
} from '../controllers/webhookController.js';

const router = Router();

// Bulk upsert (registered before '/' — both are POST but on distinct paths).
router.post('/bulk', receiveCredentialBulkWebhook);

router.post('/', extractCredentialsFromBody(), receiveCredentialWebhook);

export default router;
